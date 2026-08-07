import type {
  getSandbox,
  bootstrapFromSnapshotStreaming,
} from "@/lib/sandbox/client";
import type {
  stopSandboxRecord,
  updateSandboxRecord,
} from "@/lib/sandbox/records";
import type {
  loadOwnedSandboxRouteContext,
  loadOwnedSandboxRouteRecord,
  resolveLoadedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import type { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";
import type {
  enforceSandboxBootLimits,
  releaseLimitClaim,
} from "@/lib/request-limits";
import type {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
  requireSandboxBillingSession,
} from "@/lib/billing/sandbox-usage";

// ---- Legacy restart record (non-persistent path, re-POSTs /api/sandbox) ----

export type RestartSandboxRecord = {
  id: string;
  repo_id?: string | null;
  sandbox_id: string;
  base_branch?: string | null;
  working_branch?: string | null;
  status: string;
  persistent?: boolean | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
};

// ---- Persistent restart record (includes repo for in-place bootstrap) ----

export type PersistentRestartRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string | null;
  working_branch: string | null;
  status: string;
  health_status: string | null;
  preview_url: string | null;
  snapshot_id: string | null;
  runtime: string | null;
  terminal_cwd: string | null;
  /**
   * Snapshot of the launch-time path; preferred over repo.root_directory
   * so a restarted sandbox boots in the same workspace it was launched at.
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

export type SandboxRestartDeps = {
  loadOwnedSandboxRouteRecord: typeof loadOwnedSandboxRouteRecord;
  loadOwnedSandboxRouteContext: typeof loadOwnedSandboxRouteContext;
  resolveLoadedSandboxRouteContext: typeof resolveLoadedSandboxRouteContext;
  getSandbox: typeof getSandbox;
  stopSandboxRecord: typeof stopSandboxRecord;
  updateSandboxRecord: typeof updateSandboxRecord;
  resolveRepoSandboxEnv: typeof resolveRepoSandboxEnv;
  bootstrapFromSnapshotStreaming: typeof bootstrapFromSnapshotStreaming;
  enforceSandboxBootLimits: typeof enforceSandboxBootLimits;
  releaseLimitClaim: typeof releaseLimitClaim;
  fetchImpl: typeof fetch;
  requireSandboxBillingSession: typeof requireSandboxBillingSession;
  prepareSandboxBillingClose: typeof prepareSandboxBillingClose;
  finalizeSandboxBillingClose: typeof finalizeSandboxBillingClose;
};
