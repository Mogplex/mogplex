import { Sandbox } from "@vercel/sandbox";
import {
  DEFAULT_SANDBOX_TIMEOUT_MS,
  DEFAULT_ENV_SYNC_MODE,
  buildRuntimeSandboxEnv,
  normalizeDevPort,
  normalizeRootDirectory,
  normalizeSandboxTimeoutMs,
  resolveSandboxPath,
} from "@/lib/repo-settings";
import { isValidSandboxRootDirectory } from "@/lib/sandbox/launch-config";
import { prepareSandboxVercelLink } from "@/lib/vercel/env-vars";
import { detectRuntime, getStrategy } from "@/lib/sandbox/runtimes";
import {
  detectWorkspaceDependencies,
  resolveMonorepoWebTarget,
} from "@/lib/sandbox/runtimes/node";
import { checkSandboxHealth } from "@/lib/sandbox/health-status";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes";
import type { LinkedVercelProject } from "@/lib/vercel/env-vars";
import type { EnvSyncMode, RepoEnvVars } from "@/lib/repo-settings";
import type { NetworkPolicy } from "@vercel/sandbox";
import type { SandboxBootstrapStreamEvent } from "@/lib/sandbox/events";
import { computeLockfileHashFromSandbox } from "@/lib/sandbox/lockfile-hash";
import { BaselineSnapshotRestoreError } from "@/lib/sandbox/baseline-errors";
import { SandboxCreateRequestValidationError } from "@/lib/sandbox/create-request-validation";
import {
  isTerminalPtyEnabled,
  TERMINAL_PTY_PORT,
} from "@/lib/sandbox/terminal-pty-config";

export { BaselineSnapshotRestoreError } from "@/lib/sandbox/baseline-errors";
export {
  SandboxCreateRequestValidationError,
  type SandboxCreateRequestValidationCode,
} from "@/lib/sandbox/create-request-validation";

type CreateSandboxOpts = {
  vercelToken: string;
  vercelTeamId?: string | null;
  vercelProjectId: string;
  githubToken: string;
  repoFullName: string;
  branch?: string;
  runtime?: SandboxRuntime | null;
  devPort?: number | null;
  timeoutMs?: number | null;
  envVars?: RepoEnvVars | null;
  networkPolicy?: NetworkPolicy;
  /**
   * Stable sandbox name. When omitted, Vercel auto-generates one. Our
   * launch flow passes `mogplex-{repoShort}-{branch}-{recordShort}` so
   * operators can locate a user's sandbox in the Vercel dashboard.
   */
  name?: string;
  /**
   * Create a persistent sandbox (v2 beta). Defaults to true — auto-
   * snapshots filesystem state when the session stops so a later
   * Sandbox.get({ name, resume: true }) restarts from the last state.
   */
  persistent?: boolean;
  /**
   * Default snapshot expiration in ms for auto-snapshots. Defaults to
   * 7 days. Use 0 for no expiration.
   */
  snapshotExpirationMs?: number;
  onResume?: (sandbox: Sandbox) => Promise<void>;
};

// 7 days — long enough for a vacation, short enough to not leak
// snapshot storage when a user abandons a workspace.
const DEFAULT_PERSISTENT_SNAPSHOT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;
// Observed Vercel Sandbox create failures reject env payloads above 4096 bytes
// (`bad_request: env payload too large ... max 4096`). We measure the raw env
// object JSON as a cheap preflight estimate; Vercel remains the source of truth.
export const MAX_SANDBOX_ENV_PAYLOAD_BYTES = 4096;

// Keep this list scoped to ports we've seen Vercel reject at create time.
// 8080 is a known reserved system port in production failures; do not add
// ports like 8000 until the matching runtime defaults move with it.
const RESERVED_SANDBOX_CREATE_PORTS = new Set([8080]);
const SANDBOX_ENV_SUMMARY_LIMIT = 3;

function isTruthyEnvValue(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

export function measureSandboxEnvPayloadBytes(envVars: RepoEnvVars): number {
  return Buffer.byteLength(JSON.stringify(envVars), "utf8");
}

function summarizeLargestSandboxEnvVars(envVars: RepoEnvVars): string {
  return Object.entries(envVars)
    .map(([key, value]) => ({
      key,
      bytes: Buffer.byteLength(JSON.stringify({ [key]: value }), "utf8"),
    }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, SANDBOX_ENV_SUMMARY_LIMIT)
    .map(({ key, bytes }) => `${key} (${bytes} bytes)`)
    .join(", ");
}

export function validateSandboxCreateRequest(input: {
  envVars: RepoEnvVars;
  ports: Iterable<number>;
}): void {
  const reservedPort = Array.from(input.ports).find((port) =>
    RESERVED_SANDBOX_CREATE_PORTS.has(port)
  );
  if (typeof reservedPort === "number") {
    throw new SandboxCreateRequestValidationError(
      "reserved_port",
      `Sandbox requested reserved port ${reservedPort}. Change the repo sandbox dev port or dev command to a supported port such as 3000 or 5173.`
    );
  }

  const payloadBytes = measureSandboxEnvPayloadBytes(input.envVars);
  if (payloadBytes <= MAX_SANDBOX_ENV_PAYLOAD_BYTES) {
    return;
  }

  const largestEntries = summarizeLargestSandboxEnvVars(input.envVars);
  const largestEntriesSuffix = largestEntries
    ? ` Largest entries: ${largestEntries}.`
    : "";
  throw new SandboxCreateRequestValidationError(
    "env_payload_too_large",
    `Sandbox env payload is too large for Vercel Sandbox (${payloadBytes} bytes; max ${MAX_SANDBOX_ENV_PAYLOAD_BYTES}). Remove or shorten sandbox env vars before launching.${largestEntriesSuffix}`
  );
}

/**
 * Feature flag: persistent sandboxes are OFF by default per the
 * migration plan, pending per-team Vercel permission confirmation
 * and real-VM QA. Two env vars control behaviour:
 *
 * - `ENABLE_PERSISTENT_SANDBOXES=true` — opt every new sandbox INTO
 *   persistence. Set this once the Vercel team permission is
 *   confirmed and you've verified the pause/resume UX end-to-end.
 * - `DISABLE_PERSISTENT_SANDBOXES=true` — hard off, kept as an
 *   alias / emergency rollback toggle that wins over ENABLE.
 *
 * When NEITHER is set, behaviour defaults to ephemeral (persistent:
 * false). This matches Phase 10 of the plan — the migration ships
 * in the repo but not the runtime until an operator opts in.
 *
 * The automatic 403 fallback (see createWithPersistentFallback below)
 * further protects against projects that lack the permission once
 * ENABLE is flipped on.
 */
export function persistentSandboxesDisabledByEnv(): boolean {
  // Explicit disable wins.
  if (isTruthyEnvValue(process.env.DISABLE_PERSISTENT_SANDBOXES)) return true;
  // Explicit enable opts in. Anything else (unset, empty, "false",
  // "no", etc.) keeps the feature off per the plan's default-off
  // Phase 10 requirement.
  return !isTruthyEnvValue(process.env.ENABLE_PERSISTENT_SANDBOXES);
}

function resolvePersistentSandboxOptions(opts: {
  persistent?: boolean;
  snapshotExpirationMs?: number;
}): { persistent: boolean; snapshotExpiration: number } {
  const persistent =
    !persistentSandboxesDisabledByEnv() && (opts.persistent ?? true);
  return {
    persistent,
    snapshotExpiration:
      opts.snapshotExpirationMs ?? DEFAULT_PERSISTENT_SNAPSHOT_EXPIRATION_MS,
  };
}

/**
 * Classify whether an error from Sandbox.create signals that the
 * Vercel team/project lacks the persistent-sandboxes beta permission.
 * The SDK doesn't yet expose a typed error class for this, so we
 * match on message + any exposed status-like fields defensively.
 *
 * Exported for test coverage.
 */
export function isPersistentSandboxPermissionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as {
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };
  const status = anyErr.status ?? anyErr.statusCode;
  if (status === 403) return true;
  if (typeof anyErr.message !== "string") return false;
  const msg = anyErr.message.toLowerCase();
  const mentionsPersistent = msg.includes("persistent");
  const mentionsDenied =
    msg.includes("permission") ||
    msg.includes("forbidden") ||
    msg.includes("not enabled") ||
    msg.includes("not allowed") ||
    msg.includes("403");
  return mentionsPersistent && mentionsDenied;
}

/**
 * Run `attempt` once with `persistent: true`; on a permission error,
 * retry once with `persistent: false`. Used by the two Sandbox.create
 * helpers so we gracefully degrade when the target Vercel project
 * doesn't have the persistent-sandboxes permission granted.
 */
async function createWithPersistentFallback<TSandbox>(
  attempt: (persistent: boolean) => Promise<TSandbox>,
  requestedPersistent: boolean
): Promise<TSandbox> {
  if (!requestedPersistent) {
    return attempt(false);
  }
  try {
    return await attempt(true);
  } catch (err) {
    if (!isPersistentSandboxPermissionError(err)) throw err;
    console.warn(
      "[sandbox/create] Persistent sandbox creation denied by Vercel, falling back to ephemeral",
      { error: err instanceof Error ? err.message : err }
    );
    return attempt(false);
  }
}

type BootstrapSandboxOpts = {
  rootDirectory?: string | null;
  installCommand?: string | null;
  devCommand?: string | null;
  devPort?: number | null;
  envVars?: RepoEnvVars | null;
  envSyncMode?: EnvSyncMode | null;
  linkedVercelProject?: LinkedVercelProject | null;
  runtime?: SandboxRuntime | null;
};

type BootstrapDetection = Awaited<ReturnType<typeof detectRuntime>>;
type BootstrapStrategy = ReturnType<typeof getStrategy>;
type PreviewReadyResult = {
  ready: true;
  healthStatus: SandboxHealthStatus;
  statusCode: number | null;
  previewError: string | null;
  devLog: string;
};
type SandboxBootstrapLogPhase = "install" | "workspace" | "rebuild" | "dev";

type ResolvedBootstrapContext = {
  normalizedRoot: string | null;
  effectiveRuntime: SandboxRuntime;
  strategy: BootstrapStrategy;
  effectiveDetection: BootstrapDetection;
  packageManager: BootstrapDetection["packageManager"];
  framework: BootstrapDetection["framework"];
  frameworkEntry: BootstrapDetection["frameworkEntry"];
  packageDevScript: string | null;
  hasDevScript: boolean;
  readiness: PreviewReadinessOptions;
  previewUrl: string;
  runtimeEnv: ReturnType<typeof buildRuntimeSandboxEnv>;
  devLogPath: string;
  installCommand: string;
  devCommand: string;
  /**
   * Command that compiles workspace:* dependencies of the target package so
   * their `dist/` outputs exist before dev starts. Null when the project
   * has no workspace deps, or the package manager doesn't support filtered
   * workspace builds (npm, bun).
   */
  workspaceBuildCommand: string | null;
  installDir: string | null;
  vercelLinkWarning: string | null;
  /** Populated when we auto-selected a workspace member as the preview
   * target (e.g. redirected to `web/` for a monorepo whose root isn't a web
   * app). Surfaces as a warning so the user sees where dev actually runs. */
  monorepoAutoTargetMessage: string | null;
};

export class SandboxBootstrapError extends Error {
  installLog?: string;
  devLog?: string;
  previewUrl?: string;

  constructor(
    message: string,
    details?: { installLog?: string; devLog?: string; previewUrl?: string }
  ) {
    super(message);
    this.name = "SandboxBootstrapError";
    this.installLog = details?.installLog;
    this.devLog = details?.devLog;
    this.previewUrl = details?.previewUrl;
  }
}

const DEV_SERVER_SIGNAL_TIMEOUT_MS = 90_000;
const NO_DEV_SCRIPT_MESSAGE =
  "No dev script found in package.json — sandbox ready for terminal and file access.";
const PREVIEW_READY_PATTERNS = [
  /\blocal:\s*https?:\/\//i,
  /\blocalhost:\d+/i,
  /\b127\.0\.0\.1:\d+/i,
  /\bready in\b/i,
  /\bcompiled successfully\b/i,
  /\blistening on\b/i,
  /\brunning on https?:\/\//i,
  /\bapplication startup complete\b/i,
  /\bserver started\b/i,
];

function escapeShell(value: string) {
  return value.replace(/'/g, String.raw`'\''`);
}

/**
 * INVARIANT: `rootDirectory` MUST have already passed
 * `isValidSandboxRootDirectory` upstream (e.g. via the launch validator
 * in `lib/sandbox/launch-config.ts`). The single-quote shell escape
 * below is the last line of defence — assert the path is well-formed
 * here so a future caller that bypasses the launch flow (a new resume
 * helper, an admin endpoint, a direct DB write reader) cannot smuggle
 * a NUL byte, parent traversal, or absolute path into the shell.
 *
 * Throws TypeError on invalid input so the caller fails loudly instead
 * of silently dropping the `cd` and running the command at the sandbox
 * root, which would be confusing to debug.
 */
function buildShellCommand(command: string, rootDirectory?: string | null) {
  if (!isValidSandboxRootDirectory(rootDirectory)) {
    throw new TypeError(
      "buildShellCommand: rootDirectory must pass isValidSandboxRootDirectory"
    );
  }
  const normalizedRoot = normalizeRootDirectory(rootDirectory);
  if (!normalizedRoot) return command;
  return `cd '${escapeShell(normalizedRoot)}' && ${command}`;
}

function buildDetachedDevLaunchCommand(devCommand: string) {
  return String.raw`mkdir -p .mogplex && { (${devCommand}) 2>&1 | tee .mogplex/dev.log & printf '%s\n' "$!" > .mogplex/dev.pid; wait "$!"; }`;
}

/** Resolve the dev port based on framework. Vite defaults to 5173, everything else to 3000. */
export function extractPortFromCommand(command?: string | null) {
  if (!command) return null;

  const matchers = [
    /(?:^|\s)--port(?:=|\s+)(\d{2,5})(?=$|\s)/,
    /(?:^|\s)-p(?:=|\s+)(\d{2,5})(?=$|\s)/,
    /(?:^|\s)PORT=(\d{2,5})(?=$|\s)/,
  ];

  for (const matcher of matchers) {
    const matched = command.match(matcher);
    const port = matched?.[1] ? Number(matched[1]) : Number.NaN;
    if (Number.isFinite(port) && port > 0) {
      return normalizeDevPort(port);
    }
  }

  return null;
}

function resolveDevPort(
  explicit: number | null | undefined,
  framework: string | undefined,
  strategy: { defaultPort: number },
  ...commandHints: Array<string | null | undefined>
) {
  if (explicit) return normalizeDevPort(explicit);
  for (const hint of commandHints) {
    const inferred = extractPortFromCommand(hint);
    if (inferred) return inferred;
  }
  if (framework === "vite") return 5173;
  return normalizeDevPort(strategy.defaultPort);
}

async function resolveBootstrapDetection(
  sandbox: Sandbox,
  normalizedRoot: string | null,
  runtimeOverride?: SandboxRuntime | null
) {
  const detection = await detectRuntime(sandbox, normalizedRoot);
  const effectiveRuntime = runtimeOverride || detection.runtime;
  const strategy = getStrategy(effectiveRuntime);
  const effectiveDetection =
    runtimeOverride && runtimeOverride !== detection.runtime
      ? (await strategy.detect(sandbox, normalizedRoot)) || detection
      : detection;

  return {
    effectiveRuntime,
    strategy,
    effectiveDetection,
  };
}

async function readPackageDevScriptInfo(
  sandbox: Sandbox,
  normalizedRoot: string | null
) {
  try {
    const pkgPath = resolveSandboxPath(normalizedRoot, "package.json");
    const pkgText = await readSandboxTextFile(sandbox, pkgPath);
    if (!pkgText) {
      return {
        packageDevScript: null,
        hasDevScript: true,
      };
    }

    const pkg = JSON.parse(pkgText) as { scripts?: Record<string, string> };
    const packageDevScript =
      typeof pkg.scripts?.dev === "string" ? pkg.scripts.dev.trim() : null;

    return {
      packageDevScript,
      hasDevScript: Boolean(packageDevScript),
    };
  } catch {
    return {
      packageDevScript: null,
      hasDevScript: true,
    };
  }
}

function buildPreviewReadinessOptions(input: {
  runtime?: SandboxRuntime | null;
  framework?: string;
}): PreviewReadinessOptions {
  return {
    treatRoot404AsReady: previewAllowsRoot404(input),
  };
}

function resolveBootstrapPortHints(
  packageDevScript: string | null,
  config: {
    extraPortHints?: Array<string | null | undefined>;
    includePackageDevScriptForPort?: boolean;
  }
) {
  return [
    ...(config.extraPortHints ?? []),
    config.includePackageDevScriptForPort === false ? null : packageDevScript,
  ];
}

function resolveBootstrapInstallCommand(
  installCommand: string | null | undefined,
  strategy: BootstrapStrategy,
  packageManager: BootstrapDetection["packageManager"]
) {
  return installCommand?.trim() || strategy.buildInstallCommand(packageManager);
}

/**
 * Strip conflicting Next.js bundler flags from the resolved dev command.
 *
 * When the package.json dev script already contains --turbopack but the
 * resolved command (from a DB override or buildDevCommand) appends --webpack
 * (or vice versa), Next.js crashes with "Multiple bundler flags set".
 *
 * This sanitiser removes the conflicting flag so the project's own choice is
 * respected regardless of where the command originates.
 */
function sanitizeNextBundlerFlags(
  devCommand: string,
  packageDevScript: string | null | undefined
): string {
  if (!packageDevScript) return devCommand;

  const scriptHasTurbopack = /--turbopack\b/.test(packageDevScript);
  const scriptHasWebpack = /--webpack\b/.test(packageDevScript);

  if (scriptHasTurbopack && /--webpack\b/.test(devCommand)) {
    return devCommand
      .replace(/\s+--\s+--webpack\b/, "")
      .replace(/\s+--webpack\b/, "")
      .trim();
  }

  if (scriptHasWebpack && /--turbopack\b/.test(devCommand)) {
    return devCommand
      .replace(/\s+--\s+--turbopack\b/, "")
      .replace(/\s+--turbopack\b/, "")
      .trim();
  }

  return devCommand;
}

function resolveBootstrapDevCommand(
  devCommand: string | null | undefined,
  strategy: BootstrapStrategy,
  packageManager: BootstrapDetection["packageManager"],
  framework: BootstrapDetection["framework"],
  frameworkEntry: BootstrapDetection["frameworkEntry"],
  packageDevScript?: string | null
) {
  const resolved =
    devCommand?.trim() ||
    strategy.buildDevCommand(
      packageManager,
      framework,
      frameworkEntry,
      packageDevScript
    );

  return sanitizeNextBundlerFlags(resolved, packageDevScript);
}

async function patchBootstrapConfigIfNeeded(
  sandbox: Sandbox,
  strategy: BootstrapStrategy,
  framework: BootstrapDetection["framework"],
  normalizedRoot: string | null,
  hasDevCommandOverride: boolean
) {
  if (strategy.patchConfig && !hasDevCommandOverride) {
    await strategy.patchConfig(sandbox, framework, normalizedRoot);
  }
}

function resolveInstallDir(
  detection: BootstrapDetection,
  normalizedRoot: string | null
) {
  return detection.installFromRoot ? null : normalizedRoot;
}

async function resolveBootstrapContext(
  sandbox: Sandbox,
  opts: BootstrapSandboxOpts,
  config: {
    extraPortHints?: Array<string | null | undefined>;
    includePackageDevScriptForPort?: boolean;
  } = {}
): Promise<ResolvedBootstrapContext> {
  const userRoot = normalizeRootDirectory(opts.rootDirectory);
  // Auto-redirect to a web-app workspace when the caller didn't pin a
  // rootDirectory and the repo root isn't itself a web app (e.g.
  // credit-renew's root is an Apify actor but `web/` is a Next.js app).
  const autoTarget = userRoot ? null : await resolveMonorepoWebTarget(sandbox);
  const normalizedRoot = autoTarget?.path
    ? normalizeRootDirectory(autoTarget.path)
    : userRoot;
  const monorepoAutoTargetMessage = autoTarget
    ? `Auto-selected monorepo preview target: ${autoTarget.path}` +
      (autoTarget.framework ? ` (${autoTarget.framework})` : "") +
      ". Set a root directory in repo settings to override."
    : null;
  const { effectiveRuntime, strategy, effectiveDetection } =
    await resolveBootstrapDetection(sandbox, normalizedRoot, opts.runtime);
  const { packageManager, framework, frameworkEntry } = effectiveDetection;
  const { packageDevScript, hasDevScript } = await readPackageDevScriptInfo(
    sandbox,
    normalizedRoot
  );
  const workspaceBuildCommand = await resolveWorkspaceBuildCommand(
    sandbox,
    normalizedRoot,
    strategy,
    packageManager
  );
  const readiness = buildPreviewReadinessOptions({
    runtime: effectiveRuntime,
    framework,
  });
  const devPort = resolveDevPort(
    opts.devPort,
    framework,
    strategy,
    ...resolveBootstrapPortHints(packageDevScript, config)
  );
  const previewUrl = sandbox.domain(devPort);
  const runtimeEnv = buildRuntimeSandboxEnv(
    opts.envVars,
    opts.envSyncMode ?? DEFAULT_ENV_SYNC_MODE,
    previewUrl
  );
  const devLogPath = resolveSandboxPath(normalizedRoot, ".mogplex/dev.log");
  const preparedVercelLink = await prepareSandboxVercelLink(sandbox, {
    rootDirectory: normalizedRoot,
    envSyncMode: opts.envSyncMode,
    envVars: runtimeEnv,
    linkedProject: opts.linkedVercelProject,
  });

  await patchBootstrapConfigIfNeeded(
    sandbox,
    strategy,
    framework,
    normalizedRoot,
    Boolean(opts.devCommand)
  );

  return {
    normalizedRoot,
    effectiveRuntime,
    strategy,
    effectiveDetection,
    packageManager,
    framework,
    frameworkEntry,
    packageDevScript,
    hasDevScript,
    readiness,
    previewUrl,
    runtimeEnv,
    devLogPath,
    installCommand: resolveBootstrapInstallCommand(
      opts.installCommand,
      strategy,
      packageManager
    ),
    devCommand: resolveBootstrapDevCommand(
      opts.devCommand,
      strategy,
      packageManager,
      framework,
      frameworkEntry,
      packageDevScript
    ),
    installDir: resolveInstallDir(effectiveDetection, normalizedRoot),
    workspaceBuildCommand,
    vercelLinkWarning: preparedVercelLink.warning ?? null,
    monorepoAutoTargetMessage,
  };
}

/**
 * If the target package depends on workspace:* packages that need to be
 * compiled (e.g. a `@credit-renew/shared` package whose `main` points at
 * `dist/index.js`), returns a command that builds those deps. Returns null
 * when there are no workspace deps or the package manager doesn't support
 * filtered workspace builds.
 */
async function resolveWorkspaceBuildCommand(
  sandbox: Sandbox,
  normalizedRoot: string | null,
  strategy: BootstrapStrategy,
  packageManager: BootstrapDetection["packageManager"]
): Promise<string | null> {
  if (!strategy.buildWorkspaceDepsBuildCommand) return null;
  const { packageName, hasWorkspaceDeps } = await detectWorkspaceDependencies(
    sandbox,
    normalizedRoot
  );
  if (!hasWorkspaceDeps || !packageName) return null;
  return strategy.buildWorkspaceDepsBuildCommand(packageManager, packageName);
}

/**
 * Create a sandbox using the provided Vercel credentials.
 * Uses the user's own token if connected, otherwise falls back to platform credentials.
 */
export async function createSandboxForRepo(opts: CreateSandboxOpts) {
  const runtime = opts.runtime || "node22";
  const strategy = getStrategy(runtime);
  const devPort = normalizeDevPort(opts.devPort ?? strategy.defaultPort);
  const timeout = normalizeSandboxTimeoutMs(
    opts.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS
  );
  const envVars = buildRuntimeSandboxEnv(opts.envVars, DEFAULT_ENV_SYNC_MODE);

  const ports = new Set([devPort, ...strategy.defaultPorts]);
  if (isTerminalPtyEnabled()) {
    // Phase 2b: reserve the terminal bridge port so the in-sandbox PTY
    // server is reachable from the browser. Existing sandboxes created
    // without this flag won't gain the port — they need to relaunch.
    ports.add(TERMINAL_PTY_PORT);
  }
  validateSandboxCreateRequest({ envVars, ports });

  const persistenceOpts = resolvePersistentSandboxOptions(opts);
  return createWithPersistentFallback(
    (persistent) =>
      withTimeout(
        Sandbox.create({
          token: opts.vercelToken,
          projectId: opts.vercelProjectId,
          ...(opts.vercelTeamId ? { teamId: opts.vercelTeamId } : {}),
          ...(opts.name ? { name: opts.name } : {}),
          runtime,
          source: {
            type: "git",
            url: `https://github.com/${opts.repoFullName}.git`,
            username: "x-access-token",
            password: opts.githubToken,
            revision: opts.branch || "main",
            depth: 1,
          },
          env: envVars,
          ports: Array.from(ports),
          timeout,
          ...persistenceOpts,
          persistent,
          ...(opts.networkPolicy ? { networkPolicy: opts.networkPolicy } : {}),
          ...(opts.onResume ? { onResume: opts.onResume } : {}),
        }),
        BOOTSTRAP_STEP_TIMEOUT_MS,
        "Sandbox.create"
      ),
    persistenceOpts.persistent
  );
}

/**
 * Reconnect to an existing sandbox using the user's credentials.
 * In the v2 SDK the first argument is the sandbox *name* (formerly the
 * system-generated id) — we kept the parameter name `sandboxId` for
 * backward compatibility with our DB column, which now stores names.
 *
 * Pass `{ resume: true }` for operations that should wake a stopped
 * persistent sandbox; the default is `false` so callers that only need
 * to probe status or tear the VM down don't accidentally respawn it.
 */
export async function getSandbox(
  sandboxId: string,
  credentials: {
    vercelToken: string;
    vercelTeamId?: string | null;
    vercelProjectId: string;
  },
  opts: {
    resume?: boolean;
    onResume?: (sandbox: Sandbox) => Promise<void>;
  } = {}
) {
  return Sandbox.get({
    name: sandboxId,
    resume: opts.resume ?? false,
    token: credentials.vercelToken,
    projectId: credentials.vercelProjectId,
    ...(credentials.vercelTeamId ? { teamId: credentials.vercelTeamId } : {}),
    ...(opts.onResume ? { onResume: opts.onResume } : {}),
  });
}

type CreateFromSnapshotOpts = {
  vercelToken: string;
  vercelTeamId?: string | null;
  vercelProjectId: string;
  snapshotId: string;
  runtime?: SandboxRuntime | null;
  devPort?: number | null;
  timeoutMs?: number | null;
  envVars?: RepoEnvVars | null;
  networkPolicy?: NetworkPolicy;
  name?: string;
  persistent?: boolean;
  snapshotExpirationMs?: number;
  onResume?: (sandbox: Sandbox) => Promise<void>;
};

/**
 * Create a sandbox from a snapshot. Much faster than git source (~5-10s vs 35-165s).
 */
export async function createSandboxFromSnapshot(opts: CreateFromSnapshotOpts) {
  const runtime = opts.runtime || "node22";
  const strategy = getStrategy(runtime);
  const devPort = normalizeDevPort(opts.devPort ?? strategy.defaultPort);
  const timeout = normalizeSandboxTimeoutMs(
    opts.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS
  );
  const envVars = buildRuntimeSandboxEnv(opts.envVars, DEFAULT_ENV_SYNC_MODE);
  const ports = new Set([devPort, ...strategy.defaultPorts]);
  if (isTerminalPtyEnabled()) {
    // Phase 2b: reserve the terminal bridge port so the in-sandbox PTY
    // server is reachable from the browser. Existing sandboxes created
    // without this flag won't gain the port — they need to relaunch.
    ports.add(TERMINAL_PTY_PORT);
  }
  validateSandboxCreateRequest({ envVars, ports });

  const persistenceOpts = resolvePersistentSandboxOptions(opts);
  return createWithPersistentFallback(
    (persistent) =>
      withTimeout(
        Sandbox.create({
          token: opts.vercelToken,
          projectId: opts.vercelProjectId,
          ...(opts.vercelTeamId ? { teamId: opts.vercelTeamId } : {}),
          ...(opts.name ? { name: opts.name } : {}),
          source: {
            type: "snapshot",
            snapshotId: opts.snapshotId,
          },
          env: envVars,
          ports: Array.from(ports),
          timeout,
          ...persistenceOpts,
          persistent,
          ...(opts.networkPolicy ? { networkPolicy: opts.networkPolicy } : {}),
          ...(opts.onResume ? { onResume: opts.onResume } : {}),
        }),
        BOOTSTRAP_STEP_TIMEOUT_MS,
        "Sandbox.create (snapshot)"
      ),
    persistenceOpts.persistent
  );
}

/**
 * Create a snapshot from a running sandbox. Stops the sandbox as a side effect.
 */
export async function snapshotSandbox(
  sandbox: Sandbox,
  opts?: { expiration?: number }
) {
  return sandbox.snapshot({ expiration: opts?.expiration });
}

/** Extend the active VM session by `durationMs`. */
export async function extendSandboxTimeout(
  sandbox: Sandbox,
  durationMs: number
) {
  await sandbox.extendTimeout(durationMs);
}

/**
 * List all sandboxes for the given credentials via Sandbox.list().
 * Returns the raw list from Vercel — use for batch reconciliation.
 */
export async function listVercelSandboxes(creds: {
  vercelToken: string;
  vercelTeamId?: string | null;
  vercelProjectId: string;
}) {
  const result = await Sandbox.list({
    token: creds.vercelToken,
    projectId: creds.vercelProjectId,
    ...(creds.vercelTeamId ? { teamId: creds.vercelTeamId } : {}),
  });
  return result.sandboxes;
}

/**
 * Lighter bootstrap for snapshot-restored sandboxes.
 * Deps are already installed — only starts the dev server.
 */
export async function* bootstrapFromSnapshotStreaming(
  sandbox: Sandbox,
  opts: BootstrapSandboxOpts = {}
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  const context = await resolveBootstrapContext(sandbox, opts, {
    extraPortHints: [opts.devCommand],
  });
  if (context.monorepoAutoTargetMessage) {
    yield { type: "warning", message: context.monorepoAutoTargetMessage };
  }
  if (context.vercelLinkWarning) {
    yield { type: "warning", message: context.vercelLinkWarning };
  }

  // Skip install — deps are already in the snapshot

  if (!context.hasDevScript) {
    yield {
      type: "log",
      phase: "dev",
      data: "Snapshot restored — no dev script found. Ready for terminal and file access.\n",
    };
    yield { type: "preview_url", url: context.previewUrl };
    yield { type: "status", status: "running" };
    return;
  }

  // Start dev server
  const devLaunch = await launchDetachedDevCommand(
    sandbox,
    context.normalizedRoot,
    context.devCommand,
    context.runtimeEnv
  );

  yield { type: "preview_url", url: context.previewUrl };
  yield* streamPreviewSignal(
    sandbox,
    devLaunch,
    context.previewUrl,
    context.devLogPath,
    context.readiness
  );

  yield { type: "status", status: "running" };
}

type BaselineSnapshotBootstrapOpts = BootstrapSandboxOpts & {
  baseBranch: string;
  workingBranch: string;
  createBranch: boolean;
  expectedLockfileHash: string;
};

async function runShellInSandbox(
  sandbox: Sandbox,
  command: string,
  runtimeEnv: ReturnType<typeof buildRuntimeSandboxEnv>,
  rootDir: string | null,
  label: string
): Promise<{ stdout: string; stderr: string }> {
  const result = await withTimeout(
    sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", buildShellCommand(command, rootDir)],
      env: runtimeEnv,
    }),
    BOOTSTRAP_STEP_TIMEOUT_MS,
    label
  );
  const [stdout, stderr] = await Promise.all([
    result.stdout(),
    result.stderr(),
  ]);
  if (result.exitCode !== 0) {
    const tail = [stdout, stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${label} failed (exit ${result.exitCode}): ${tail}`);
  }
  return { stdout, stderr };
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, String.raw`'\''`)}'`;
}

async function* runBaselineFetchPhase(
  sandbox: Sandbox,
  context: ResolvedBootstrapContext,
  opts: BaselineSnapshotBootstrapOpts
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  const fetchRefs = opts.createBranch
    ? [opts.baseBranch]
    : [opts.baseBranch, opts.workingBranch];
  const fetchCommand = `git fetch --depth=1 origin ${fetchRefs
    .map(shellQuote)
    .join(" ")}`;
  try {
    const fetchResult = await runShellInSandbox(
      sandbox,
      fetchCommand,
      context.runtimeEnv,
      context.normalizedRoot,
      `git fetch ${fetchRefs.join(",")}`
    );
    if (fetchResult.stdout) {
      yield { type: "log", phase: "install", data: fetchResult.stdout };
    }
  } catch (error) {
    throw new BaselineSnapshotRestoreError(
      error instanceof Error ? error.message : "git fetch failed",
      "fetch",
      error
    );
  }
}

async function* runBaselineCheckoutPhase(
  sandbox: Sandbox,
  context: ResolvedBootstrapContext,
  opts: BaselineSnapshotBootstrapOpts
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  const checkoutCommand = opts.createBranch
    ? `git checkout -b ${shellQuote(opts.workingBranch)} origin/${shellQuote(
        opts.baseBranch
      )} && git push -u origin ${shellQuote(opts.workingBranch)}`
    : `git checkout -B ${shellQuote(opts.workingBranch)} origin/${shellQuote(
        opts.workingBranch
      )}`;
  try {
    const checkoutResult = await runShellInSandbox(
      sandbox,
      checkoutCommand,
      context.runtimeEnv,
      context.normalizedRoot,
      `git checkout ${opts.workingBranch}`
    );
    if (checkoutResult.stdout) {
      yield { type: "log", phase: "install", data: checkoutResult.stdout };
    }
  } catch (error) {
    throw new BaselineSnapshotRestoreError(
      error instanceof Error ? error.message : "git checkout failed",
      "checkout",
      error
    );
  }
}

async function* runBaselineConditionalInstallPhase(
  sandbox: Sandbox,
  context: ResolvedBootstrapContext,
  expectedLockfileHash: string
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  const postCheckoutHash = await computeLockfileHashFromSandbox(
    sandbox,
    context.normalizedRoot
  );
  if (!postCheckoutHash || postCheckoutHash.hash === expectedLockfileHash) {
    return;
  }

  yield {
    type: "log",
    phase: "install",
    data: `Lockfile drift detected after checkout — running ${context.installCommand}\n`,
  };
  const installCmd = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      buildShellCommand(context.installCommand, context.installDir),
    ],
    env: context.runtimeEnv,
    detached: true,
  });
  const installLog = yield* streamCommandPhase(installCmd, "install");
  const installResult = await installCmd.wait();
  if (installResult.exitCode !== 0) {
    throw new BaselineSnapshotRestoreError(
      `Install failed (${context.installCommand})`,
      "install",
      installLog
    );
  }
}

async function* runBaselineDevPhase(
  sandbox: Sandbox,
  context: ResolvedBootstrapContext
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  if (!context.hasDevScript) {
    yield {
      type: "log",
      phase: "dev",
      data: "Snapshot restored — no dev script found. Ready for terminal and file access.\n",
    };
    yield { type: "preview_url", url: context.previewUrl };
    yield { type: "status", status: "running" };
    return;
  }

  const devLaunch = await launchDetachedDevCommand(
    sandbox,
    context.normalizedRoot,
    context.devCommand,
    context.runtimeEnv
  );
  yield { type: "preview_url", url: context.previewUrl };
  yield* streamPreviewSignal(
    sandbox,
    devLaunch,
    context.previewUrl,
    context.devLogPath,
    context.readiness
  );
  yield { type: "status", status: "running" };
}

/**
 * Bootstrap a sandbox that was restored from a baseline snapshot.
 *
 * Unlike `bootstrapFromSnapshotStreaming` (used for manual snapshot restores),
 * this variant runs `git fetch` + `git checkout` to move the working tree to
 * `workingBranch` and only re-installs dependencies when the checked-out
 * lockfile hash diverges from the baseline. Failures during the fetch,
 * checkout, or post-checkout install raise `BaselineSnapshotRestoreError`
 * so the launch route can fall back to the git-clone path.
 */
export async function* bootstrapFromBaselineSnapshotStreaming(
  sandbox: Sandbox,
  opts: BaselineSnapshotBootstrapOpts
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  const context = await resolveBootstrapContext(sandbox, opts, {
    extraPortHints: [opts.devCommand],
  });
  if (context.monorepoAutoTargetMessage) {
    yield { type: "warning", message: context.monorepoAutoTargetMessage };
  }
  if (context.vercelLinkWarning) {
    yield { type: "warning", message: context.vercelLinkWarning };
  }

  yield { type: "status", status: "installing" };
  yield* runBaselineFetchPhase(sandbox, context, opts);
  yield* runBaselineCheckoutPhase(sandbox, context, opts);
  yield* runBaselineConditionalInstallPhase(
    sandbox,
    context,
    opts.expectedLockfileHash
  );
  yield* runBaselineDevPhase(sandbox, context);
}

/**
 * Build a NetworkPolicy that injects AI Gateway auth headers.
 */
export function buildAIGatewayNetworkPolicy(
  providerKeys: Record<string, string>
): NetworkPolicy {
  const rules: Record<
    string,
    { transform?: { headers: Record<string, string> }[] }[]
  > = {};

  const gatewayRules: { transform?: { headers: Record<string, string> }[] }[] =
    [];

  // Inject auth headers for AI Gateway
  if (Object.keys(providerKeys).length > 0) {
    const headers: Record<string, string> = {};
    for (const [provider, key] of Object.entries(providerKeys)) {
      // AI Gateway routes by x-provider header
      headers[`x-${provider}-api-key`] = key;
    }
    gatewayRules.push({ transform: [{ headers }] });
  }

  rules["ai-gateway.vercel.sh"] = gatewayRules;

  // Allow all other traffic
  rules["*"] = [];

  return { allow: rules };
}

/** Default timeout for bootstrap steps (install, dev server launch). */
const BOOTSTRAP_STEP_TIMEOUT_MS = 180_000; // 3 minutes

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms
    );
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

async function readSandboxTextFile(sandbox: Sandbox, path: string) {
  const buffer = await sandbox.readFileToBuffer({ path });
  return buffer ? buffer.toString("utf-8") : "";
}

/**
 * Extract the last N lines of dev-server output as a readable excerpt.
 * Used to embed the real failure cause into the bootstrap error message
 * so the UI error card can show it inline, instead of just "Preview did
 * not become ready on <url>".
 */
function extractDevLogTail(
  log: string | null | undefined,
  maxLines = 20,
  maxChars = 2000
): string {
  if (!log) return "";
  const trimmed = log.trim();
  if (!trimmed) return "";
  const lines = trimmed.split("\n");
  const tail = lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
  return tail.length > maxChars
    ? `...${tail.slice(tail.length - maxChars)}`
    : tail;
}

function buildPreviewReadyResult(
  health: Awaited<ReturnType<typeof classifyPreviewHealth>>,
  devLog: string
): PreviewReadyResult {
  return {
    ready: true,
    healthStatus: health.healthStatus,
    statusCode: health.statusCode,
    previewError: health.healthStatus === "running" ? null : health.message,
    devLog,
  };
}

async function failPreviewBootstrap(
  sandbox: Sandbox,
  previewUrl: string,
  devLogPath: string,
  message: string
): Promise<never> {
  const devLog = await readSandboxTextFile(sandbox, devLogPath);
  const tail = extractDevLogTail(devLog);
  const withContext = tail
    ? `${message}\n\nLast dev-server output:\n${tail}`
    : message;
  throw new SandboxBootstrapError(withContext, {
    previewUrl,
    devLog,
  });
}

async function resolvePreviewHealthResult(
  sandbox: Sandbox,
  previewUrl: string,
  devLogPath: string,
  health: Awaited<ReturnType<typeof classifyPreviewHealth>>
) {
  return buildPreviewReadyResult(
    health,
    await readSandboxTextFile(sandbox, devLogPath)
  );
}

async function resolveRetriedPreviewHealthResult(
  sandbox: Sandbox,
  previewUrl: string,
  devLogPath: string,
  readiness?: PreviewReadinessOptions
) {
  const health = await retryPreviewHealth(previewUrl, readiness);
  if (!health) {
    return null;
  }

  return resolvePreviewHealthResult(sandbox, previewUrl, devLogPath, health);
}

export function logSignalsPreviewReady(chunk: string) {
  return PREVIEW_READY_PATTERNS.some((pattern) => pattern.test(chunk));
}

/**
 * Extract the port the dev server actually bound to from a log chunk.
 * Covers the common framework outputs: Next.js ("Local: http://localhost:3003"),
 * Vite (same), Nuxt, Astro, Express/Nest (":3000" / "listening on 3000").
 *
 * Returns null when no port is found. Used to rebind the preview URL when
 * the server falls back to a different port (e.g. 3000 already in use →
 * Next picks 3001).
 */
export function extractBoundPortFromLog(chunk: string): number | null {
  const patterns = [
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/i,
    /\blistening on\s+(?:https?:\/\/[^\s:]+:)?(\d{2,5})\b/i,
    /\bserver started.*:(\d{2,5})\b/i,
  ];
  for (const pattern of patterns) {
    const match = chunk.match(pattern);
    const port = match?.[1] ? Number(match[1]) : Number.NaN;
    if (Number.isFinite(port) && port > 0 && port < 65536) {
      return port;
    }
  }
  return null;
}

function replacePortInSandboxDomain(
  sandbox: Sandbox,
  currentUrl: string,
  boundPort: number
): { url: string; changed: boolean } {
  try {
    const expected = new URL(currentUrl).port;
    if (expected && Number(expected) === boundPort) {
      return { url: currentUrl, changed: false };
    }
    const nextUrl = sandbox.domain(boundPort);
    if (!nextUrl || nextUrl === currentUrl) {
      return { url: currentUrl, changed: false };
    }
    return { url: nextUrl, changed: true };
  } catch {
    return { url: currentUrl, changed: false };
  }
}

type PreviewReadinessOptions = {
  treatRoot404AsReady?: boolean;
};

export function previewAllowsRoot404(input?: {
  runtime?: SandboxRuntime | null;
  framework?: string;
}) {
  if (input?.runtime?.startsWith("python")) return true;
  return ["fastapi", "uvicorn", "flask", "django"].includes(
    input?.framework || ""
  );
}

function isUsablePreviewHealth(status: SandboxHealthStatus) {
  return status === "running" || status === "app_error";
}

async function classifyPreviewHealth(
  previewUrl: string,
  options?: PreviewReadinessOptions
) {
  const health = await checkSandboxHealth(previewUrl, undefined, options);
  return {
    ready: isUsablePreviewHealth(health.status),
    healthStatus: health.status,
    statusCode: health.statusCode ?? null,
    message: health.message,
  };
}

type SandboxStreamingCommand = {
  logs: () => AsyncIterable<{ data: string }>;
  wait: () => Promise<{ exitCode: number | null }>;
};

/** Retry health check a few times after the dev process exits — the sandbox proxy may need a moment. */
export async function retryPreviewHealth(
  previewUrl: string,
  options?: PreviewReadinessOptions,
  retries = 4,
  delayMs = 2000
) {
  for (let i = 0; i <= retries; i++) {
    const health = await classifyPreviewHealth(previewUrl, options);
    if (health.ready) return health;
    if (i < retries) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

type PreviewSignalRaceWinner =
  | {
      kind: "log";
      entry: Awaited<ReturnType<AsyncIterator<{ data: string }>["next"]>>;
    }
  | { kind: "exit"; result: { exitCode: number | null } }
  | { kind: "timeout" };

function createPreviewSignalTimeoutPromise() {
  return new Promise<{ kind: "timeout" }>((resolve) => {
    setTimeout(
      () => resolve({ kind: "timeout" }),
      DEV_SERVER_SIGNAL_TIMEOUT_MS
    );
  });
}

function createPreviewSignalExitPromise(command: SandboxStreamingCommand) {
  return command.wait().then((result) => ({ kind: "exit" as const, result }));
}

function nextPreviewSignalWinner(
  logIterator: AsyncIterator<{ data: string }>,
  exitPromise: Promise<{ kind: "exit"; result: { exitCode: number | null } }>,
  timeoutPromise: Promise<{ kind: "timeout" }>
) {
  const logPromise = logIterator
    .next()
    .then((entry) => ({ kind: "log" as const, entry }));
  return Promise.race<PreviewSignalRaceWinner>([
    logPromise,
    exitPromise,
    timeoutPromise,
  ]);
}

async function resolveClosedPreviewSignal(
  sandbox: Sandbox,
  previewUrl: string,
  devLogPath: string,
  readiness: PreviewReadinessOptions | undefined
) {
  const result = await resolveRetriedPreviewHealthResult(
    sandbox,
    previewUrl,
    devLogPath,
    readiness
  );
  if (result) {
    return result;
  }

  return failPreviewBootstrap(
    sandbox,
    previewUrl,
    devLogPath,
    `Dev server exited before preview became ready on ${previewUrl}`
  );
}

async function resolveTimedOutPreviewSignal(
  sandbox: Sandbox,
  previewUrl: string,
  devLogPath: string,
  readiness: PreviewReadinessOptions | undefined
) {
  const health = await classifyPreviewHealth(previewUrl, readiness);
  if (health.ready) {
    return resolvePreviewHealthResult(sandbox, previewUrl, devLogPath, health);
  }

  return failPreviewBootstrap(
    sandbox,
    previewUrl,
    devLogPath,
    `Preview did not become ready on ${previewUrl}`
  );
}

async function waitForPreviewSignal(
  sandbox: Sandbox,
  command: SandboxStreamingCommand,
  previewUrl: string,
  devLogPath: string,
  options: {
    readiness?: PreviewReadinessOptions;
  } = {}
) {
  const logIterator = command.logs()[Symbol.asyncIterator]();
  const timeoutPromise = createPreviewSignalTimeoutPromise();
  const exitPromise = createPreviewSignalExitPromise(command);

  try {
    while (true) {
      const winner = await nextPreviewSignalWinner(
        logIterator,
        exitPromise,
        timeoutPromise
      );

      if (winner.kind === "log") {
        if (winner.entry.done) {
          return resolveClosedPreviewSignal(
            sandbox,
            previewUrl,
            devLogPath,
            options.readiness
          );
        }

        if (logSignalsPreviewReady(winner.entry.value.data)) {
          const result = await resolveRetriedPreviewHealthResult(
            sandbox,
            previewUrl,
            devLogPath,
            options.readiness
          );
          if (result) {
            return result;
          }
        }

        continue;
      }

      if (winner.kind === "exit") {
        return resolveClosedPreviewSignal(
          sandbox,
          previewUrl,
          devLogPath,
          options.readiness
        );
      }

      return resolveTimedOutPreviewSignal(
        sandbox,
        previewUrl,
        devLogPath,
        options.readiness
      );
    }
  } finally {
    await logIterator.return?.();
  }
}

function buildNoDevScriptBootstrapResult(
  context: Pick<
    ResolvedBootstrapContext,
    | "previewUrl"
    | "effectiveRuntime"
    | "packageManager"
    | "framework"
    | "installCommand"
  >,
  installLog: string
) {
  return {
    previewUrl: context.previewUrl,
    runtime: context.effectiveRuntime,
    packageManager: context.packageManager,
    framework: context.framework,
    installCommand: context.installCommand,
    devCommand: "(none)",
    installLog,
    devLog: NO_DEV_SCRIPT_MESSAGE,
    healthStatus: "running" as const,
    readiness: { ready: true as const },
  };
}

async function launchDetachedDevCommand(
  sandbox: Sandbox,
  normalizedRoot: string | null,
  devCommand: string,
  runtimeEnv: ReturnType<typeof buildRuntimeSandboxEnv>,
  timeoutLabel?: string
) {
  const command = sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      buildShellCommand(
        buildDetachedDevLaunchCommand(devCommand),
        normalizedRoot
      ),
    ],
    env: runtimeEnv,
    detached: true,
  });

  return timeoutLabel
    ? withTimeout(command, BOOTSTRAP_STEP_TIMEOUT_MS, timeoutLabel)
    : command;
}

async function runInstallPhase(
  sandbox: Sandbox,
  installCommand: string,
  installDir: string | null,
  runtimeEnv: ReturnType<typeof buildRuntimeSandboxEnv>,
  previewUrl: string
) {
  const install = await withTimeout(
    sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", buildShellCommand(installCommand, installDir)],
      env: runtimeEnv,
    }),
    BOOTSTRAP_STEP_TIMEOUT_MS,
    `Install (${installCommand})`
  );
  const [installStdout, installStderr] = await Promise.all([
    install.stdout(),
    install.stderr(),
  ]);
  const installLog = [installStdout, installStderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  if (install.exitCode !== 0) {
    throw new SandboxBootstrapError(`Install failed (${installCommand})`, {
      installLog,
      previewUrl,
    });
  }

  return installLog;
}

function buildSelectiveRebuildCommand(
  packageManager: BootstrapDetection["packageManager"],
  rebuildTargets: string[]
) {
  return packageManager === "yarn"
    ? `yarn rebuild ${rebuildTargets.join(" ")} 2>/dev/null || true`
    : `${packageManager} rebuild ${rebuildTargets.join(" ")} 2>/dev/null || true`;
}

/**
 * Build workspace:* dependencies so their compiled outputs exist before
 * `pnpm dev` runs. Runs from the repo root (null installDir) because the
 * filter command operates across the entire workspace, not a sub-package.
 *
 * Swallows non-zero exit to avoid masking downstream dev failures — if a
 * workspace build truly breaks dev, the dev log will show the real cause.
 */
async function runWorkspaceBuildPhase(
  sandbox: Sandbox,
  workspaceBuildCommand: string | null,
  runtimeEnv: ReturnType<typeof buildRuntimeSandboxEnv>
): Promise<string> {
  if (!workspaceBuildCommand) return "";
  const command = await withTimeout(
    sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", `${workspaceBuildCommand} 2>&1 || true`],
      env: runtimeEnv,
    }),
    BOOTSTRAP_STEP_TIMEOUT_MS,
    `Workspace deps build (${workspaceBuildCommand})`
  );
  const [stdout, stderr] = await Promise.all([
    command.stdout(),
    command.stderr(),
  ]);
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}

async function runSelectiveRebuildPhase(
  sandbox: Sandbox,
  context: Pick<
    ResolvedBootstrapContext,
    "packageManager" | "installDir" | "runtimeEnv" | "strategy"
  >,
  hasCustomInstallCommand: boolean
) {
  if (hasCustomInstallCommand || !context.strategy.rebuildTargets?.length) {
    return;
  }

  const rebuildCmd = buildSelectiveRebuildCommand(
    context.packageManager,
    context.strategy.rebuildTargets
  );
  await withTimeout(
    sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", buildShellCommand(rebuildCmd, context.installDir)],
      env: context.runtimeEnv,
    }),
    BOOTSTRAP_STEP_TIMEOUT_MS,
    "Selective rebuild"
  );
}

async function* streamCommandPhase(
  command: SandboxStreamingCommand,
  phase: SandboxBootstrapLogPhase
): AsyncGenerator<SandboxBootstrapStreamEvent, string> {
  let output = "";

  for await (const log of command.logs()) {
    output += log.data;
    yield { type: "log", phase, data: log.data };
  }

  return output.trim();
}

async function* streamPreviewSignal(
  sandbox: Sandbox,
  command: SandboxStreamingCommand,
  previewUrl: string,
  devLogPath: string,
  readiness?: PreviewReadinessOptions
): AsyncGenerator<SandboxBootstrapStreamEvent, PreviewReadyResult> {
  const logIterator = command.logs()[Symbol.asyncIterator]();
  const timeoutPromise = createPreviewSignalTimeoutPromise();
  const exitPromise = createPreviewSignalExitPromise(command);
  let activePreviewUrl = previewUrl;

  try {
    while (true) {
      const winner = await nextPreviewSignalWinner(
        logIterator,
        exitPromise,
        timeoutPromise
      );

      if (winner.kind === "log") {
        if (winner.entry.done) {
          return resolveClosedPreviewSignal(
            sandbox,
            activePreviewUrl,
            devLogPath,
            readiness
          );
        }

        const chunk = winner.entry.value.data;
        yield { type: "log", phase: "dev", data: chunk };

        // If the dev server tells us its actual port (e.g. Next fell back
        // from 3000 to 3003), follow it. Emits a new preview_url event so
        // the UI stops probing the wrong domain.
        const boundPort = extractBoundPortFromLog(chunk);
        if (boundPort) {
          const { url: nextUrl, changed } = replacePortInSandboxDomain(
            sandbox,
            activePreviewUrl,
            boundPort
          );
          if (changed) {
            activePreviewUrl = nextUrl;
            yield { type: "preview_url", url: nextUrl };
          }
        }

        if (!logSignalsPreviewReady(chunk)) {
          continue;
        }

        const result = await resolveRetriedPreviewHealthResult(
          sandbox,
          activePreviewUrl,
          devLogPath,
          readiness
        );
        if (result) {
          return result;
        }
        continue;
      }

      if (winner.kind === "exit") {
        return resolveClosedPreviewSignal(
          sandbox,
          activePreviewUrl,
          devLogPath,
          readiness
        );
      }

      return resolveTimedOutPreviewSignal(
        sandbox,
        activePreviewUrl,
        devLogPath,
        readiness
      );
    }
  } finally {
    await logIterator.return?.();
  }
}

/**
 * Auto-install deps and start dev server. Returns preview URL.
 * Delegates to the matched RuntimeStrategy for detection, install, and dev commands.
 */
export async function bootstrapSandbox(
  sandbox: Sandbox,
  opts: BootstrapSandboxOpts = {}
) {
  const context = await resolveBootstrapContext(sandbox, opts, {
    extraPortHints: [opts.devCommand],
  });

  if (context.monorepoAutoTargetMessage) {
    console.info("[sandbox/bootstrap]", context.monorepoAutoTargetMessage);
  }
  if (context.vercelLinkWarning) {
    console.warn("[sandbox/bootstrap]", context.vercelLinkWarning);
  }

  const installLog = await runInstallPhase(
    sandbox,
    context.installCommand,
    context.installDir,
    context.runtimeEnv,
    context.previewUrl
  );
  await runWorkspaceBuildPhase(
    sandbox,
    context.workspaceBuildCommand,
    context.runtimeEnv
  );
  await runSelectiveRebuildPhase(
    sandbox,
    context,
    Boolean(opts.installCommand)
  );

  // If no dev script, skip dev server — sandbox is usable for terminal/files/editor
  if (!context.hasDevScript) {
    return buildNoDevScriptBootstrapResult(context, installLog);
  }

  // Start dev server in background (with timeout)
  const devLaunch = await launchDetachedDevCommand(
    sandbox,
    context.normalizedRoot,
    context.devCommand,
    context.runtimeEnv,
    `Dev server launch (${context.devCommand})`
  );
  const previewReadiness = await waitForPreviewSignal(
    sandbox,
    devLaunch,
    context.previewUrl,
    context.devLogPath,
    {
      readiness: context.readiness,
    }
  );
  const { devLog } = previewReadiness;

  return {
    previewUrl: context.previewUrl,
    runtime: context.effectiveRuntime,
    packageManager: context.packageManager,
    framework: context.framework,
    installCommand: context.installCommand,
    devCommand: context.devCommand,
    installLog,
    devLog,
    healthStatus: previewReadiness.healthStatus,
    readiness: previewReadiness,
  };
}

/**
 * Streaming variant of bootstrapSandbox. Uses `detached: true` + `command.logs()`
 * to yield real-time log output as SandboxEvents instead of blocking until completion.
 *
 * The existing `bootstrapSandbox()` is kept for backward compat (workflows/cron).
 */
export async function* bootstrapSandboxStreaming(
  sandbox: Sandbox,
  opts: BootstrapSandboxOpts = {}
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  // packageDevScript must participate in port resolution — for monorepos
  // where `apps/web/package.json` pins the port via "next dev -p 3003",
  // ignoring it made us route the preview to 3000 while the server bound
  // somewhere else. Also forward the user's devCommand (if any) so an
  // explicit --port in repo settings wins over package.json.
  const context = await resolveBootstrapContext(sandbox, opts, {
    extraPortHints: [opts.devCommand],
  });
  if (context.monorepoAutoTargetMessage) {
    yield { type: "warning", message: context.monorepoAutoTargetMessage };
  }
  if (context.vercelLinkWarning) {
    yield { type: "warning", message: context.vercelLinkWarning };
  }

  // --- Install phase ---
  yield { type: "status", status: "installing" };

  const installCmd = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      buildShellCommand(context.installCommand, context.installDir),
    ],
    env: context.runtimeEnv,
    detached: true,
  });
  const installLog = yield* streamCommandPhase(installCmd, "install");

  const installResult = await installCmd.wait();
  if (installResult.exitCode !== 0) {
    throw new SandboxBootstrapError(
      `Install failed (${context.installCommand})`,
      {
        previewUrl: context.previewUrl,
        installLog,
      }
    );
  }

  // --- Workspace deps build phase ---
  // Compile workspace:* packages (e.g. a shared TS package whose `main`
  // points at `dist/index.js`) so runtime imports resolve before dev runs.
  // Runs from repo root (null installDir) because the filter command
  // operates across the workspace, not a sub-directory. Trailing `|| true`
  // keeps us from masking downstream dev failures with a build error.
  if (context.workspaceBuildCommand) {
    const workspaceCmd = await sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", `${context.workspaceBuildCommand} 2>&1 || true`],
      env: context.runtimeEnv,
      detached: true,
    });
    yield* streamCommandPhase(workspaceCmd, "workspace");
    await workspaceCmd.wait();
  }

  // --- Rebuild phase ---
  if (!opts.installCommand && context.strategy.rebuildTargets?.length) {
    const rebuildCmd = buildSelectiveRebuildCommand(
      context.packageManager,
      context.strategy.rebuildTargets
    );
    const rebuild = await sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", buildShellCommand(rebuildCmd, context.installDir)],
      env: context.runtimeEnv,
      detached: true,
    });
    yield* streamCommandPhase(rebuild, "rebuild");
    await rebuild.wait();
  }

  // --- No dev script: done early ---
  if (!context.hasDevScript) {
    yield {
      type: "log",
      phase: "dev",
      data: `${NO_DEV_SCRIPT_MESSAGE}\n`,
    };
    yield { type: "preview_url", url: context.previewUrl };
    yield { type: "status", status: "running" };
    return;
  }

  // --- Dev server phase ---
  const devLaunch = await launchDetachedDevCommand(
    sandbox,
    context.normalizedRoot,
    context.devCommand,
    context.runtimeEnv
  );

  yield { type: "preview_url", url: context.previewUrl };
  yield* streamPreviewSignal(
    sandbox,
    devLaunch,
    context.previewUrl,
    context.devLogPath,
    context.readiness
  );

  yield { type: "status", status: "running" };
}
