import { normalizeRepoSandboxBillingModeOverride } from "@/lib/sandbox/billing";
import { SUPPORTED_RUNTIMES } from "@/lib/sandbox/runtimes/types";
import type { RepoSandboxBillingModeOverride } from "@/lib/sandbox/billing";
import type { SandboxRuntime } from "@/lib/sandbox/runtimes/types";

export const DEFAULT_DEV_PORT = 3000;
export const DEFAULT_SANDBOX_TIMEOUT_MS = 5 * 60 * 60 * 1000;
export const MIN_SANDBOX_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_SANDBOX_TIMEOUT_MS = 5 * 60 * 60 * 1000;
// Idle timeout is the reaper's cap on how long a sandbox can sit untouched
// before we stop it, independent of the VM's own lifetime. Kept lower than
// DEFAULT_SANDBOX_TIMEOUT_MS so that long-lived sandboxes still free up
// quickly when the user walks away.
export const DEFAULT_SANDBOX_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const MIN_SANDBOX_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_SANDBOX_BILLING_TARGET = "personal";
export const DEFAULT_ENV_SYNC_MODE = "sandbox-only";
export const VERCEL_PROJECT_ENV_SYNC_AVAILABLE = false;

export type RepoEnvVars = Record<string, string>;
export type SandboxBillingTarget = "personal" | "team";
export type EnvSyncMode =
  | "sandbox-only"
  | "sandbox-and-preview"
  | "vercel-project";
export type { SandboxRuntime } from "@/lib/sandbox/runtimes/types";

export function normalizeRuntime(value: unknown): SandboxRuntime | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return (SUPPORTED_RUNTIMES as readonly string[]).includes(trimmed)
    ? (trimmed as SandboxRuntime)
    : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeRootDirectory(value: unknown) {
  const trimmed = normalizeText(value);
  if (!trimmed) return null;
  const stripped = trimmed
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
  // Treat a bare "." (POSIX "current directory") as "repo root" so it
  // collapses to null instead of leaving the literal "." flowing through
  // to the DB and the shell's `cd '.'`. Same intent as the leading `./`
  // strip above — POSIX-equivalent paths must produce the same result.
  if (stripped === "" || stripped === ".") return null;
  return stripped;
}

export function normalizeDevPort(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_DEV_PORT;
  return Math.floor(parsed);
}

export function normalizeDevPortAuto(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "false") return false;
    if (trimmed === "true") return true;
  }
  return true;
}

export function resolveConfiguredDevPort(value: unknown, autoValue: unknown) {
  return normalizeDevPortAuto(autoValue) ? null : normalizeDevPort(value);
}

export function normalizeSandboxTimeoutMs(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SANDBOX_TIMEOUT_MS;
  return clamp(
    Math.floor(parsed),
    MIN_SANDBOX_TIMEOUT_MS,
    MAX_SANDBOX_TIMEOUT_MS
  );
}

export function normalizeOptionalSandboxTimeoutMs(value: unknown) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  return normalizeSandboxTimeoutMs(value);
}

export function resolveEffectiveSandboxTimeoutMs(input: {
  repoTimeoutMs?: unknown;
  workspaceTimeoutMs?: unknown;
}) {
  // Repo timeout fields are retained for wire/database compatibility but are
  // no longer applied: there is no repo-level control that can expose them,
  // so honoring old hidden values produced unexplained non-uniform lifetimes.
  const workspaceTimeoutMs = normalizeOptionalSandboxTimeoutMs(
    input.workspaceTimeoutMs
  );
  if (workspaceTimeoutMs != null) return workspaceTimeoutMs;

  return DEFAULT_SANDBOX_TIMEOUT_MS;
}

export function normalizeSandboxIdleTimeoutMs(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SANDBOX_IDLE_TIMEOUT_MS;
  return clamp(
    Math.floor(parsed),
    MIN_SANDBOX_IDLE_TIMEOUT_MS,
    MAX_SANDBOX_TIMEOUT_MS
  );
}

export function normalizeOptionalSandboxIdleTimeoutMs(value: unknown) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  return normalizeSandboxIdleTimeoutMs(value);
}

/**
 * Resolves the effective idle-timeout threshold used by the reaper.
 * Workspace setting → app default. Also clamped to the
 * lifetime timeout so "idle > lifetime" can never happen.
 */
export function resolveEffectiveSandboxIdleTimeoutMs(input: {
  repoIdleTimeoutMs?: unknown;
  workspaceIdleTimeoutMs?: unknown;
  lifetimeTimeoutMs?: number;
}) {
  const workspaceIdle = normalizeOptionalSandboxIdleTimeoutMs(
    input.workspaceIdleTimeoutMs
  );
  const idle = workspaceIdle ?? DEFAULT_SANDBOX_IDLE_TIMEOUT_MS;
  const lifetime = input.lifetimeTimeoutMs;
  if (
    typeof lifetime === "number" &&
    Number.isFinite(lifetime) &&
    lifetime > 0
  ) {
    return Math.min(idle, lifetime);
  }
  return idle;
}

export function normalizeSandboxBillingTarget(
  value: unknown
): SandboxBillingTarget {
  return value === "team" ? "team" : DEFAULT_SANDBOX_BILLING_TARGET;
}

export function normalizeEnvSyncMode(value: unknown): EnvSyncMode {
  if (value === "sandbox-and-preview") return "sandbox-and-preview";
  if (value === "vercel-project") return "vercel-project";
  return DEFAULT_ENV_SYNC_MODE;
}

export function resolveEffectiveEnvSyncMode(value: unknown): EnvSyncMode {
  const mode = normalizeEnvSyncMode(value);
  return mode === "vercel-project" && !VERCEL_PROJECT_ENV_SYNC_AVAILABLE
    ? DEFAULT_ENV_SYNC_MODE
    : mode;
}

function normalizeEnvVarValue(value: unknown) {
  const stringValue = typeof value === "string" ? value : String(value ?? "");
  const trimmed = stringValue.trim();

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    const innerValue = trimmed.slice(1, -1);

    if (trimmed.startsWith('"')) {
      return innerValue.replace(/\\([\\nrt"])/g, (_match, escaped) => {
        switch (escaped) {
          case "n":
            return "\n";
          case "r":
            return "\r";
          case "t":
            return "\t";
          case '"':
            return '"';
          case "\\":
            return "\\";
          default:
            return escaped;
        }
      });
    }

    return innerValue.replace(/\\([\\'])/g, (_match, escaped) =>
      escaped === "\\" ? "\\" : "'"
    );
  }

  return stringValue;
}

function formatEnvVarValue(value: string) {
  if (
    value.includes("\n") ||
    value.includes("\r") ||
    value.includes("\t") ||
    value !== value.trim()
  ) {
    return JSON.stringify(value);
  }

  return value;
}

export function normalizeEnvVars(value: unknown): RepoEnvVars {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: RepoEnvVars = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim();
    if (!key) continue;
    normalized[key] = normalizeEnvVarValue(rawValue);
  }
  return normalized;
}

export function hasConfiguredSandboxEnv(repo: {
  sandbox_env_vars?: unknown;
  env_sync_mode?: unknown;
  vercel_project_id?: string | null;
}): boolean {
  const manual = normalizeEnvVars(repo.sandbox_env_vars);
  if (Object.keys(manual).length > 0) return true;
  const mode = resolveEffectiveEnvSyncMode(repo.env_sync_mode);
  return mode === "vercel-project" && Boolean(repo.vercel_project_id);
}

export function formatEnvVars(value: RepoEnvVars | null | undefined) {
  if (!value) return "";
  return Object.entries(normalizeEnvVars(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, envValue]) => `${key}=${formatEnvVarValue(envValue)}`)
    .join("\n");
}

export function parseEnvVarsText(input: string): RepoEnvVars {
  const envVars: RepoEnvVars = {};

  for (const rawLine of input.split("\n")) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;

    const separatorIndex = rawLine.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid env var line: ${rawLine}`);
    }

    const key = rawLine.slice(0, separatorIndex).trim();
    const value = rawLine.slice(separatorIndex + 1);

    if (!key) {
      throw new Error(`Invalid env var line: ${rawLine}`);
    }

    envVars[key] = normalizeEnvVarValue(value);
  }

  return envVars;
}

export function resolveSandboxPath(
  rootDirectory: string | null | undefined,
  path: string
) {
  if (!path || path === ".") {
    return normalizeRootDirectory(rootDirectory) || ".";
  }

  if (path.startsWith("/")) return path;

  if (rootDirectory?.startsWith("/")) {
    return `${rootDirectory.replace(/\/+$/, "")}/${path.replace(/^\.\/+/, "")}`;
  }

  const normalizedRoot = normalizeRootDirectory(rootDirectory);
  const normalizedPath = path.replace(/^\.\/+/, "");

  return normalizedRoot
    ? `${normalizedRoot}/${normalizedPath}`
    : normalizedPath;
}

/**
 * Resolve the working subdirectory the UI should display / operate against
 * for a given sandbox + repo pair. Mirrors the three-way contract that
 * `loadOwnedSandboxRouteContext` enforces server-side
 * (lib/sandbox/route-context.ts) so client-side displays stay aligned
 * with the path the sandbox was actually launched at.
 *
 *   - sandbox.root_directory === undefined → SELECT/wire didn't include
 *                                            the field; fall back to the
 *                                            repo's persistent default.
 *   - sandbox.root_directory === null      → explicit "repo root" launch
 *                                            override; treat as "no
 *                                            subdirectory" regardless of
 *                                            the repo default.
 *   - sandbox.root_directory is a string   → use that path verbatim.
 *
 * Returns `null` when the effective path is "repo root", a normalized
 * relative path otherwise. UI consumers can render `value ?? "/"` or
 * conditionally show the path only when non-null.
 */
export function resolveSandboxRootDirectory(
  sandbox: { root_directory?: string | null } | null | undefined,
  repo: { root_directory?: string | null } | null | undefined
): string | null {
  const sandboxField = sandbox?.root_directory;
  if (sandboxField === undefined) {
    return normalizeRootDirectory(repo?.root_directory);
  }
  if (sandboxField === null) {
    return null;
  }
  return normalizeRootDirectory(sandboxField);
}

export function buildRuntimeSandboxEnv(
  value: unknown,
  envSyncMode: unknown,
  previewUrl?: string | null
) {
  const env = normalizeEnvVars(value);
  const mode = normalizeEnvSyncMode(envSyncMode);
  if (mode !== "sandbox-and-preview" && mode !== "vercel-project") {
    return env;
  }

  const runtimeEnv = { ...env };
  if (!("VERCEL" in runtimeEnv)) runtimeEnv.VERCEL = "1";
  if (!("VERCEL_ENV" in runtimeEnv)) runtimeEnv.VERCEL_ENV = "preview";
  if (!("VERCEL_TARGET_ENV" in runtimeEnv))
    runtimeEnv.VERCEL_TARGET_ENV = "preview";
  if (!("NEXT_PUBLIC_VERCEL_ENV" in runtimeEnv))
    runtimeEnv.NEXT_PUBLIC_VERCEL_ENV = "preview";

  if (previewUrl) {
    const url = new URL(previewUrl);
    if (!("NEXT_PUBLIC_APP_URL" in runtimeEnv))
      runtimeEnv.NEXT_PUBLIC_APP_URL = previewUrl;
    if (!("NEXT_PUBLIC_SITE_URL" in runtimeEnv))
      runtimeEnv.NEXT_PUBLIC_SITE_URL = previewUrl;
    if (!("VERCEL_URL" in runtimeEnv)) runtimeEnv.VERCEL_URL = url.host;
    if (!("NEXT_PUBLIC_VERCEL_URL" in runtimeEnv))
      runtimeEnv.NEXT_PUBLIC_VERCEL_URL = url.host;
  }

  return runtimeEnv;
}

export function normalizeRepoSettings(input: {
  default_branch?: unknown;
  vercel_team_id?: unknown;
  vercel_project_id?: unknown;
  sandbox_billing_target?: unknown;
  sandbox_billing_mode_override?: unknown;
  env_sync_mode?: unknown;
  root_directory?: unknown;
  install_command?: unknown;
  dev_command?: unknown;
  dev_port?: unknown;
  dev_port_auto?: unknown;
  sandbox_timeout_ms?: unknown;
  sandbox_env_vars?: unknown;
  runtime?: unknown;
}) {
  return {
    default_branch: normalizeText(input.default_branch) || "main",
    vercel_team_id: normalizeText(input.vercel_team_id),
    vercel_project_id: normalizeText(input.vercel_project_id),
    sandbox_billing_target: normalizeSandboxBillingTarget(
      input.sandbox_billing_target
    ),
    sandbox_billing_mode_override:
      normalizeRepoSandboxBillingModeOverride(
        input.sandbox_billing_mode_override
      ) === "platform"
        ? "platform"
        : null,
    env_sync_mode: resolveEffectiveEnvSyncMode(input.env_sync_mode),
    root_directory: normalizeRootDirectory(input.root_directory),
    install_command: normalizeText(input.install_command),
    dev_command: normalizeText(input.dev_command),
    dev_port: normalizeDevPort(input.dev_port),
    dev_port_auto: normalizeDevPortAuto(input.dev_port_auto),
    sandbox_timeout_ms: normalizeOptionalSandboxTimeoutMs(
      input.sandbox_timeout_ms
    ),
    sandbox_env_vars: normalizeEnvVars(input.sandbox_env_vars),
    runtime: normalizeRuntime(input.runtime),
  };
}

export function normalizeRepoSettingsPatch(input: {
  default_branch?: unknown;
  vercel_team_id?: unknown;
  vercel_project_id?: unknown;
  sandbox_billing_target?: unknown;
  sandbox_billing_mode_override?: unknown;
  env_sync_mode?: unknown;
  root_directory?: unknown;
  install_command?: unknown;
  dev_command?: unknown;
  dev_port?: unknown;
  dev_port_auto?: unknown;
  sandbox_timeout_ms?: unknown;
  sandbox_env_vars?: unknown;
  runtime?: unknown;
}) {
  const updates: {
    default_branch?: string;
    vercel_team_id?: string | null;
    vercel_project_id?: string | null;
    sandbox_billing_target?: SandboxBillingTarget;
    sandbox_billing_mode_override?: RepoSandboxBillingModeOverride;
    env_sync_mode?: EnvSyncMode;
    root_directory?: string | null;
    install_command?: string | null;
    dev_command?: string | null;
    dev_port?: number;
    dev_port_auto?: boolean;
    sandbox_timeout_ms?: number | null;
    sandbox_env_vars?: RepoEnvVars;
    runtime?: SandboxRuntime | null;
  } = {};

  if ("default_branch" in input) {
    updates.default_branch = normalizeText(input.default_branch) || "main";
  }
  if ("vercel_team_id" in input) {
    updates.vercel_team_id = null;
  }
  if ("vercel_project_id" in input) {
    updates.vercel_project_id = null;
  }
  if ("sandbox_billing_target" in input) {
    updates.sandbox_billing_target = "personal";
  }
  if ("sandbox_billing_mode_override" in input) {
    updates.sandbox_billing_mode_override =
      normalizeRepoSandboxBillingModeOverride(
        input.sandbox_billing_mode_override
      ) === "platform"
        ? "platform"
        : null;
  }
  if ("env_sync_mode" in input) {
    updates.env_sync_mode = resolveEffectiveEnvSyncMode(input.env_sync_mode);
  }
  if ("root_directory" in input) {
    updates.root_directory = normalizeRootDirectory(input.root_directory);
  }
  if ("install_command" in input) {
    updates.install_command = normalizeText(input.install_command);
  }
  if ("dev_command" in input) {
    updates.dev_command = normalizeText(input.dev_command);
  }
  if ("dev_port" in input) {
    updates.dev_port = normalizeDevPort(input.dev_port);
  }
  if ("dev_port_auto" in input) {
    updates.dev_port_auto = normalizeDevPortAuto(input.dev_port_auto);
  }
  if ("sandbox_timeout_ms" in input) {
    updates.sandbox_timeout_ms = normalizeOptionalSandboxTimeoutMs(
      input.sandbox_timeout_ms
    );
  }
  if ("sandbox_env_vars" in input) {
    updates.sandbox_env_vars = normalizeEnvVars(input.sandbox_env_vars);
  }
  if ("runtime" in input) {
    updates.runtime = normalizeRuntime(input.runtime);
  }

  return updates;
}
