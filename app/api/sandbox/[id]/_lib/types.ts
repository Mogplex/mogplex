import type { after } from "next/server";
import type { getSandbox } from "@/lib/sandbox/client";
import type {
  deleteSandboxRecord,
  stopSandboxRecord,
  updateSandboxRecord,
} from "@/lib/sandbox/records";
import type {
  loadOwnedSandboxRouteRecord,
  resolveLoadedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import type { SandboxRecord } from "@/lib/types";
import type {
  finalizeSandboxBillingClose,
  prepareSandboxBillingClose,
} from "@/lib/billing/sandbox-usage";

export type SandboxStatusRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string;
  working_branch: string;
  snapshot_id?: string | null;
  install_log?: string | null;
  dev_log?: string | null;
  runtime?: string | null;
  terminal_cwd?: string | null;
  status: string;
  stop_reason?: SandboxRecord["stop_reason"];
  persistent?: boolean | null;
  preview_url?: string | null;
  health_status?: string | null;
  last_health_check_at?: string | null;
  last_preview_http_status?: number | null;
  boot_attempts?: number | null;
  last_boot_started_at?: string | null;
  last_boot_completed_at?: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  error?: string | null;
  last_preview_error?: string | null;
  last_boot_error?: string | null;
  created_at: string;
  last_active_at: string;
};

export type SandboxDeleteRecord = {
  id: string;
  user_id?: string | null;
  repo_id?: string | null;
  sandbox_id: string;
  base_branch?: string | null;
  working_branch?: string | null;
  status: string;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  persistent?: boolean | null;
};

export type SandboxDetailGetDeps = {
  loadOwnedSandboxRouteRecord: typeof loadOwnedSandboxRouteRecord;
  resolveLoadedSandboxRouteContext: typeof resolveLoadedSandboxRouteContext;
  stopSandboxRecord: typeof stopSandboxRecord;
  updateSandboxRecord: typeof updateSandboxRecord;
  scheduleAfter: typeof after;
};

export type SandboxDeleteDeps = {
  loadOwnedSandboxRouteRecord: typeof loadOwnedSandboxRouteRecord;
  resolveLoadedSandboxRouteContext: typeof resolveLoadedSandboxRouteContext;
  getSandbox: typeof getSandbox;
  stopSandboxRecord: typeof stopSandboxRecord;
  updateSandboxRecord: typeof updateSandboxRecord;
  deleteSandboxRecord: typeof deleteSandboxRecord;
  prepareSandboxBillingClose: typeof prepareSandboxBillingClose;
  finalizeSandboxBillingClose: typeof finalizeSandboxBillingClose;
};

export type RemoteDeleteOutcome =
  | { verified: true; stoppedRemote?: boolean; endedAt?: Date }
  | {
      verified: false;
      warning: string;
      error: string;
      endedAt?: Date;
    };
