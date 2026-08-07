import {
  getSandbox,
  bootstrapFromSnapshotStreaming,
} from "@/lib/sandbox/client";
import { updateSandboxRecord } from "@/lib/sandbox/records";
import { loadOwnedSandboxRouteContext } from "@/lib/sandbox/route-context";
import { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";
import {
  enforceSandboxBootLimits,
  releaseLimitClaim,
} from "@/lib/request-limits";
import { recordSandboxLifecycleEvent } from "@/lib/sandbox/auto-pause";
import {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
  requireSandboxBillingSession,
} from "@/lib/billing/sandbox-usage";
import type { SandboxResumeDeps } from "./types";

// Full repo + workspace select — resolveRepoSandboxEnv and the bootstrap
// helpers read env vars, dev command, runtime, and the workspace's
// inherited Vercel project link.
export const RESUME_SELECT =
  "id, repo_id, user_id, sandbox_id, base_branch, working_branch, status, stop_reason, health_status, preview_url, snapshot_id, snapshot_billing_project_id, snapshot_billing_team_id, install_log, dev_log, runtime, terminal_cwd, root_directory, error, last_preview_error, last_boot_error, created_at, last_active_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, persistent, repo:repos(*, workspace:workspaces(*))";

export const defaultSandboxResumeDeps: SandboxResumeDeps = {
  loadOwnedSandboxRouteContext,
  getSandbox,
  updateSandboxRecord,
  resolveRepoSandboxEnv,
  bootstrapFromSnapshotStreaming,
  enforceSandboxBootLimits,
  releaseLimitClaim,
  recordSandboxLifecycleEvent,
  requireSandboxBillingSession,
  prepareSandboxBillingClose,
  finalizeSandboxBillingClose,
};
