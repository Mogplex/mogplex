import type {
  getSandbox,
  bootstrapFromSnapshotStreaming,
} from "@/lib/sandbox/client";
import type { updateSandboxRecord } from "@/lib/sandbox/records";
import type { loadOwnedSandboxRouteContext } from "@/lib/sandbox/route-context";
import type { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";
import type {
  enforceSandboxBootLimits,
  releaseLimitClaim,
} from "@/lib/request-limits";
import type { recordSandboxLifecycleEvent } from "@/lib/sandbox/auto-pause";
import type {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
  requireSandboxBillingSession,
} from "@/lib/billing/sandbox-usage";

export type SandboxResumeRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string | null;
  working_branch: string | null;
  status: string;
  stop_reason: string | null;
  health_status: string | null;
  preview_url: string | null;
  snapshot_id: string | null;
  runtime: string | null;
  terminal_cwd: string | null;
  /**
   * Snapshot of the launch-time path; preferred over repo.root_directory
   * so resuming a sandbox boots the dev server in the same workspace it
   * was originally launched at.
   */
  root_directory: string | null;
  persistent: boolean | null;
  created_at: string;
  last_active_at: string | null;
  repo:
    | (Record<string, unknown> & {
        root_directory: string | null;
        dev_command: string | null;
        dev_port: number | null;
        dev_port_auto: unknown;
        runtime?: string | null;
      })
    | null
    | undefined;
};

export type SandboxResumeDeps = {
  loadOwnedSandboxRouteContext: typeof loadOwnedSandboxRouteContext;
  getSandbox: typeof getSandbox;
  updateSandboxRecord: typeof updateSandboxRecord;
  resolveRepoSandboxEnv: typeof resolveRepoSandboxEnv;
  bootstrapFromSnapshotStreaming: typeof bootstrapFromSnapshotStreaming;
  enforceSandboxBootLimits: typeof enforceSandboxBootLimits;
  releaseLimitClaim: typeof releaseLimitClaim;
  recordSandboxLifecycleEvent: typeof recordSandboxLifecycleEvent;
  requireSandboxBillingSession: typeof requireSandboxBillingSession;
  prepareSandboxBillingClose: typeof prepareSandboxBillingClose;
  finalizeSandboxBillingClose: typeof finalizeSandboxBillingClose;
};
