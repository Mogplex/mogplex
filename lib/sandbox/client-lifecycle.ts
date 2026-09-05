import { Sandbox } from "@vercel/sandbox";
import {
  DEFAULT_SANDBOX_TIMEOUT_MS,
  DEFAULT_ENV_SYNC_MODE,
  buildRuntimeSandboxEnv,
  normalizeDevPort,
  normalizeSandboxTimeoutMs,
} from "@/lib/repo-settings";
import { getStrategy } from "@/lib/sandbox/runtimes";
import {
  isTerminalPtyEnabled,
  TERMINAL_PTY_PORT,
} from "@/lib/sandbox/terminal-pty-config";
import type { NetworkPolicy } from "@vercel/sandbox";
import type { CreateSandboxOpts, CreateFromSnapshotOpts } from "./client-types";
import {
  validateSandboxCreateRequest,
  resolvePersistentSandboxOptions,
  withTimeout,
  BOOTSTRAP_STEP_TIMEOUT_MS,
} from "./client-validation";

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
  return withTimeout(
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
      ...(opts.networkPolicy ? { networkPolicy: opts.networkPolicy } : {}),
      ...(opts.onResume ? { onResume: opts.onResume } : {}),
    }),
    BOOTSTRAP_STEP_TIMEOUT_MS,
    "Sandbox.create"
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
  return withTimeout(
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
      ...(opts.networkPolicy ? { networkPolicy: opts.networkPolicy } : {}),
      ...(opts.onResume ? { onResume: opts.onResume } : {}),
    }),
    BOOTSTRAP_STEP_TIMEOUT_MS,
    "Sandbox.create (snapshot)"
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
export async function listVercelSandboxes(
  creds: {
    vercelToken: string;
    vercelTeamId?: string | null;
    vercelProjectId: string;
  },
  options: {
    limit?: number;
    sortBy?: "createdAt" | "name" | "statusUpdatedAt";
    sortOrder?: "asc" | "desc";
    namePrefix?: string;
  } = {}
) {
  const result = await Sandbox.list({
    token: creds.vercelToken,
    projectId: creds.vercelProjectId,
    ...(creds.vercelTeamId ? { teamId: creds.vercelTeamId } : {}),
    ...options,
  });
  return result.sandboxes;
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
