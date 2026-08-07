/**
 * Sandbox-related types.
 */

import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import type { SandboxVercelDiagnostics } from "@/lib/vercel/sandbox-diagnostics";

export type SandboxCallContext = {
  sandbox_record_id: string;
  sandbox_id: string;
  compute_billing_source: SandboxBillingMode;
  billing_project_id: string | null;
  billing_team_id: string | null;
  preview_url: string | null;
};

export type SandboxBillingSummary = {
  source: SandboxBillingMode;
  label: string;
  project_id: string | null;
  team_id: string | null;
  team_label: string;
};

export type SandboxRuntimeSummary = {
  sandbox_id: string;
  status: string;
  health_status: SandboxHealthStatus | string;
  preview_url: string | null;
  last_health_check_at: string | null;
  last_preview_http_status: number | null;
  boot_attempts: number;
  last_boot_started_at: string | null;
  last_boot_completed_at: string | null;
  effective_timeout_ms?: number | null;
  persistent?: boolean | null;
  vercel_diagnostics?: SandboxVercelDiagnostics | null;
};

export type SandboxErrorSummary = {
  current_error: string | null;
  last_preview_error: string | null;
  last_boot_error: string | null;
  display_error: string | null;
  has_errors: boolean;
};

export type SandboxLifecycleStatus =
  | "creating"
  | "installing"
  | "running"
  | "pausing"
  | "stopped"
  | "paused"
  | "error";

export type StopReason =
  | "idle_timeout"
  | "lifetime_timeout"
  | "manual"
  | "stuck_boot"
  | "vm_gone"
  | "auto_pause"
  | "billing_depleted"
  | "unknown";

export type SandboxRecordRow = {
  id: string;
  user_id: string;
  product_team_id?: string | null;
  actor_user_id?: string | null;
  repo_id: string;
  sandbox_id: string;
  base_branch: string;
  working_branch: string;
  limit_claim_id: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  sandbox_billing_target?: "personal" | "team";
  billing_source?: SandboxBillingMode | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  status: SandboxLifecycleStatus;
  stop_reason?: StopReason | null;
  preview_url: string | null;
  snapshot_id: string | null;
  snapshot_billing_project_id?: string | null;
  snapshot_billing_team_id?: string | null;
  install_log?: string | null;
  dev_log?: string | null;
  health_status?: SandboxHealthStatus;
  last_health_check_at?: string | null;
  last_preview_http_status?: number | null;
  last_preview_error?: string | null;
  last_boot_error?: string | null;
  boot_attempts?: number;
  last_boot_started_at?: string | null;
  last_boot_completed_at?: string | null;
  runtime?: string | null;
  terminal_cwd?: string | null;
  root_directory?: string | null;
  exec_lock_token?: string | null;
  exec_lock_started_at?: string | null;
  error: string | null;
  created_at: string;
  last_active_at: string;
};

export type SandboxClientRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string;
  working_branch: string;
  snapshot_id: string | null;
  stop_reason: StopReason | null;
  install_log?: string | null;
  dev_log?: string | null;
  runtime?: string | null;
  terminal_cwd?: string | null;
  /**
   * Per-launch working subdirectory snapshot; decoupled from
   * `repos.root_directory`. Three-way semantics:
   *   - `undefined` -> field omitted from the response by a legacy
   *                    SELECT; client should treat as "use repo default"
   *   - `null`      -> explicit "repo root" launch override
   *   - `string`    -> relative path inside the repo (e.g. "apps/web")
   *
   * Front-end consumers should NOT fall back to `repo.root_directory`
   * when this is `null` -- see lib/sandbox/route-context.ts for the
   * canonical resolution logic.
   */
  root_directory?: string | null;
  created_at: string;
  last_active_at: string;
  billing_summary: SandboxBillingSummary;
  runtime_summary: SandboxRuntimeSummary;
  error_summary: SandboxErrorSummary;
};

export type SandboxRecord = SandboxClientRecord;
