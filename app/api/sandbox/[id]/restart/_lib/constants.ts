import {
  bootstrapFromSnapshotStreaming,
  getSandbox,
} from "@/lib/sandbox/client";
import { stopSandboxRecord, updateSandboxRecord } from "@/lib/sandbox/records";
import {
  loadOwnedSandboxRouteContext,
  loadOwnedSandboxRouteRecord,
  resolveLoadedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";
import {
  enforceSandboxBootLimits,
  releaseLimitClaim,
} from "@/lib/request-limits";
import {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
  requireSandboxBillingSession,
} from "@/lib/billing/sandbox-usage";
import type { SandboxRestartDeps } from "./types";

export const PERSISTENT_RESTART_SELECT =
  "id, repo_id, user_id, sandbox_id, base_branch, working_branch, status, stop_reason, health_status, preview_url, snapshot_id, runtime, terminal_cwd, root_directory, persistent, created_at, last_active_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, repo:repos(*, workspace:workspaces(*))";

export const RESTART_INSTALLING_FROM_STATUSES = [
  "creating",
  "installing",
  "running",
  "paused",
  "stopped",
  "error",
] as const;

export const defaultSandboxRestartDeps: SandboxRestartDeps = {
  loadOwnedSandboxRouteRecord,
  loadOwnedSandboxRouteContext,
  resolveLoadedSandboxRouteContext,
  getSandbox,
  stopSandboxRecord,
  updateSandboxRecord,
  resolveRepoSandboxEnv,
  bootstrapFromSnapshotStreaming,
  enforceSandboxBootLimits,
  releaseLimitClaim,
  fetchImpl: fetch,
  requireSandboxBillingSession,
  prepareSandboxBillingClose,
  finalizeSandboxBillingClose,
};
