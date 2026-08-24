import type { SandboxRuntime } from "@/lib/sandbox/runtimes";
import type { ResolvedSandboxLaunchRequest } from "@/lib/sandbox/launch-config";
import type { SandboxRecordRow, StopReason } from "@/lib/types";
import type { SandboxSource } from "@/lib/sandbox/source-selection";
import type {
  resolveBillingLinkedProjectOwner,
  resolveBillingLinkedProjectSelection,
} from "@/lib/vercel/target-resolution";
import type { resolveSandboxCreateContext } from "@/lib/sandbox/context";
import type { SandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";
import type { startDeferredRepoSnapshotBuild } from "@/lib/workflows/repo-snapshot-workflow";
import type { createSandboxForRepo } from "@/lib/sandbox/client";
import type { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";

export type DeferredSnapshotWarmupQueueResult = Awaited<
  ReturnType<typeof startDeferredRepoSnapshotBuild>
>;

export type SandboxCreateContextResult = Awaited<
  ReturnType<typeof resolveSandboxCreateContext>
>;

export type ResolvedSandboxCreateContext = Extract<
  SandboxCreateContextResult,
  { ok: true }
>["context"];

export type SandboxInstance = Awaited<ReturnType<typeof createSandboxForRepo>>;

export type SandboxLaunchPreparation = {
  creds: SandboxServiceCredentials;
  productTeamId: string | null;
  actorUserId: string;
  repo: SandboxRepoRecord;
  githubToken: string;
  launchRequest: ResolvedSandboxLaunchRequest;
  repoId: string;
  /**
   * Effective working subdirectory for this sandbox, computed once at the
   * top of the launch flow and threaded everywhere instead of reading
   * `repo.root_directory` directly. Honours an explicit launch-time
   * override, otherwise falls back to the repo's persistent default.
   * `null` means "repo root".
   */
  effectiveRootDirectory: string | null;
  linkedProjectOwner: ReturnType<typeof resolveBillingLinkedProjectOwner>;
  linkedProject: ReturnType<typeof resolveBillingLinkedProjectSelection>;
  createContext: ResolvedSandboxCreateContext;
  effectiveSandboxTimeoutMs: number;
  configuredDevPort: number | null;
  cloneRevision: string;
  allowSnapshotRestore: boolean;
  runtime: SandboxRuntime;
  healthCheckOptions: {
    treatRoot404AsReady: boolean;
  };
  sandboxSource: SandboxSource;
  /** Fresh provider name used only to move past a terminal name collision. */
  sandboxNameOverride?: string;
};

export type PendingSandboxLaunchRecord = {
  record: SandboxRecordRow;
  limitClaimId: string | null;
};

export type SandboxLaunchState = {
  sandbox: SandboxInstance | null;
  previewUrl: string | null;
  restoredFromSnapshot: boolean;
  restoredFromBaselineSnapshot: boolean;
  shouldQueueDeferredSnapshot: boolean;
  streamSandboxRecord: SandboxRecordRow;
};

export type SandboxLaunchEnvironment = {
  envResolution: Awaited<ReturnType<typeof resolveRepoSandboxEnv>>;
  networkPolicy: Parameters<typeof createSandboxForRepo>[0]["networkPolicy"];
};

export type SandboxLaunchRuntimePreparation = Pick<
  SandboxLaunchPreparation,
  | "configuredDevPort"
  | "cloneRevision"
  | "allowSnapshotRestore"
  | "runtime"
  | "healthCheckOptions"
  | "sandboxSource"
>;

export type SandboxRouteResponseResult = { response: Response };

export type SandboxCreateContextResolution =
  | SandboxRouteResponseResult
  | { createContext: ResolvedSandboxCreateContext };

export type SandboxRepoAccessResolution =
  | SandboxRouteResponseResult
  | { repo: SandboxRepoRecord; githubToken: string };

export type SandboxLaunchRequestResolution =
  | SandboxRouteResponseResult
  | { launchRequest: ResolvedSandboxLaunchRequest };

export type SandboxLaunchPreparationResult =
  | SandboxRouteResponseResult
  | { launch: SandboxLaunchPreparation };

export type SandboxBootLimitClaimResolution =
  | SandboxRouteResponseResult
  | { limitClaimId: string | null };

export type PendingSandboxLaunchRecordResult =
  | SandboxRouteResponseResult
  | PendingSandboxLaunchRecord;

export type SandboxActiveRepoJoin = {
  full_name?: string | null;
  sandbox_timeout_ms?: number | null;
  workspaces?:
    | { name?: string | null; sandbox_timeout_ms?: number | null }
    | { name?: string | null; sandbox_timeout_ms?: number | null }[]
    | null;
};

/**
 * Flat, CLI-shaped sandbox record returned when a caller passes
 * `?format=cli`. The mogplex CLI's sandbox dashboard consumes this.
 */
export type CliSandboxRecord = {
  id: string;
  sandboxId: string | null;
  repo: string | null;
  workspace: string | null;
  branch: string | null;
  status: string;
  createdAt: string;
  url: string | null;
};

export type ActiveSandboxRecord = {
  id: string;
  sandbox_id: string;
  repo_id: string;
  user_id: string;
  product_team_id?: string | null;
  actor_user_id?: string | null;
  base_branch: string;
  working_branch: string;
  snapshot_id?: string | null;
  install_log?: string | null;
  dev_log?: string | null;
  status: string;
  stop_reason?: StopReason | null;
  preview_url: string | null;
  runtime: string | null;
  terminal_cwd?: string | null;
  health_status: string;
  last_preview_http_status?: number | null;
  last_preview_error?: string | null;
  last_boot_error?: string | null;
  boot_attempts?: number;
  last_boot_started_at?: string | null;
  last_boot_completed_at?: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  created_at: string;
  last_active_at: string;
  persistent?: boolean | null;
  repos?: SandboxActiveRepoJoin | SandboxActiveRepoJoin[] | null;
  effective_timeout_ms?: number | null;
};

export type SandboxRepoRecord = {
  id: string;
  user_id: string;
  full_name: string;
  default_branch: string | null;
  root_directory: string | null;
  sandbox_billing_mode_override?: unknown;
  runtime: SandboxRuntime | null;
  dev_port: number;
  dev_port_auto?: unknown;
  sandbox_timeout_ms: number | null;
  snapshot_id: string | null;
  install_command: string | null;
  dev_command: string | null;
  sandbox_env_vars?: unknown;
  env_sync_mode?: unknown;
  vercel_project_id?: string | null;
  vercel_team_id?: string | null;
  github_installation_id?: number | null;
  workspace?:
    | {
        id?: string;
        sandbox_billing_mode?: unknown;
        sandbox_timeout_ms?: number | null;
        sandbox_vercel_project_id?: string | null;
        sandbox_vercel_team_id?: string | null;
      }
    | Array<{
        id?: string;
        sandbox_billing_mode?: unknown;
        sandbox_timeout_ms?: number | null;
        sandbox_vercel_project_id?: string | null;
        sandbox_vercel_team_id?: string | null;
      }>
    | null;
};

export function toWorkspace(record: SandboxRepoRecord["workspace"]) {
  return Array.isArray(record) ? record[0] : record;
}

export { type SandboxLaunchRequestInput } from "@/lib/sandbox/launch-config";
