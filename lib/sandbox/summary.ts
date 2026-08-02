import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import type {
  SandboxLifecycleStatus,
  SandboxRecord,
  SandboxRecordRow,
  StopReason,
} from "@/lib/types";
import type { SandboxVercelDiagnostics } from "@/lib/vercel/sandbox-diagnostics";

type SandboxSummaryRecord = {
  sandbox_id: string;
  base_branch?: string | null;
  working_branch?: string | null;
  status?: string | null;
  stop_reason?: StopReason | null;
  health_status?: string | null;
  preview_url?: string | null;
  last_health_check_at?: string | null;
  last_preview_http_status?: number | null;
  boot_attempts?: number | null;
  last_boot_started_at?: string | null;
  last_boot_completed_at?: string | null;
  billing_source?: SandboxBillingMode | string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  error?: string | null;
  last_preview_error?: string | null;
  last_boot_error?: string | null;
  vercel_diagnostics?: SandboxVercelDiagnostics | null;
  /** VM lifetime (ms) that was effective for this sandbox at launch time.
   * Computed server-side from repo/workspace settings. Null when unknown
   * (e.g. records created before this field existed). */
  effective_timeout_ms?: number | null;
  /**
   * Raw DB column. True when this sandbox was created with
   * `persistent: true` via the v2 SDK — pause/idle preserves its
   * filesystem state and resume wakes the same sandbox name.
   */
  persistent?: boolean | null;
};

function normalizeBillingSource(
  source: SandboxSummaryRecord["billing_source"]
): SandboxBillingMode {
  return source === "user_vercel_project" ? "user_vercel_project" : "platform";
}

export function formatSandboxBillingLabel(source: SandboxBillingMode) {
  return source === "user_vercel_project"
    ? "Your Vercel project"
    : "Mogplex billing";
}

export function formatSandboxTeamLabel(teamId: string | null | undefined) {
  return teamId || "Personal";
}

export type SandboxBillingSummary = {
  source: SandboxBillingMode;
  label: string;
  project_id: string | null;
  team_id: string | null;
  team_label: string;
};

export type SandboxRuntimeSummary = {
  sandbox_id: string;
  status: SandboxLifecycleStatus;
  health_status: SandboxHealthStatus | string;
  preview_url: string | null;
  last_health_check_at: string | null;
  last_preview_http_status: number | null;
  boot_attempts: number;
  last_boot_started_at: string | null;
  last_boot_completed_at: string | null;
  effective_timeout_ms?: number | null;
  vercel_diagnostics?: SandboxVercelDiagnostics | null;
};

export type SandboxErrorSummary = {
  current_error: string | null;
  last_preview_error: string | null;
  last_boot_error: string | null;
  display_error: string | null;
  has_errors: boolean;
};

export type SandboxSummaryFields = {
  billing_summary: SandboxBillingSummary;
  runtime_summary: SandboxRuntimeSummary;
  error_summary: SandboxErrorSummary;
};

export function buildSandboxSummaryFields(
  record: SandboxSummaryRecord
): SandboxSummaryFields {
  const billingSource = normalizeBillingSource(record.billing_source);
  const projectId =
    record.billing_project_id || record.vercel_project_id || null;
  const teamId = record.billing_team_id || record.vercel_team_id || null;
  const currentError = record.error || null;
  const lastPreviewError = record.last_preview_error || null;
  const lastBootError = record.last_boot_error || null;
  const vercelDiagnostics = record.vercel_diagnostics ?? undefined;

  return {
    billing_summary: {
      source: billingSource,
      label: formatSandboxBillingLabel(billingSource),
      project_id: projectId,
      team_id: teamId,
      team_label: formatSandboxTeamLabel(teamId),
    },
    runtime_summary: {
      sandbox_id: record.sandbox_id,
      status: (record.status || "stopped") as SandboxLifecycleStatus,
      health_status: (record.health_status || "unknown") as
        | SandboxHealthStatus
        | string,
      preview_url: record.preview_url || null,
      last_health_check_at: record.last_health_check_at || null,
      last_preview_http_status: record.last_preview_http_status ?? null,
      boot_attempts:
        typeof record.boot_attempts === "number" ? record.boot_attempts : 0,
      last_boot_started_at: record.last_boot_started_at || null,
      last_boot_completed_at: record.last_boot_completed_at || null,
      ...(typeof record.effective_timeout_ms === "number"
        ? { effective_timeout_ms: record.effective_timeout_ms }
        : {}),
      ...(typeof record.persistent === "boolean"
        ? { persistent: record.persistent }
        : {}),
      ...(vercelDiagnostics === undefined
        ? {}
        : { vercel_diagnostics: vercelDiagnostics }),
    },
    error_summary: {
      current_error: currentError,
      last_preview_error: lastPreviewError,
      last_boot_error: lastBootError,
      display_error:
        currentError ||
        lastPreviewError ||
        lastBootError ||
        vercelDiagnostics?.buildSummary ||
        null,
      has_errors: Boolean(
        currentError ||
        lastPreviewError ||
        lastBootError ||
        vercelDiagnostics?.buildSummary
      ),
    },
  };
}

export function withSandboxSummaryFields<T extends SandboxSummaryRecord>(
  record: T
): T & SandboxSummaryFields {
  return {
    ...record,
    ...buildSandboxSummaryFields(record),
  };
}

type SandboxClientRecordSource = Pick<
  SandboxRecordRow,
  "id" | "user_id" | "repo_id" | "sandbox_id" | "base_branch" | "working_branch"
> & {
  snapshot_id?: string | null;
  stop_reason?: StopReason | null;
  install_log?: string | null;
  dev_log?: string | null;
  runtime?: string | null;
  terminal_cwd?: string | null;
  root_directory?: string | null;
  created_at?: string | null;
  last_active_at?: string | null;
} & SandboxSummaryRecord;

export function toSandboxClientRecord(
  record: SandboxClientRecordSource
): SandboxRecord {
  const summaries = buildSandboxSummaryFields(record);
  const now = new Date().toISOString();

  return {
    id: record.id,
    user_id: record.user_id,
    repo_id: record.repo_id,
    sandbox_id: record.sandbox_id,
    base_branch: record.base_branch ?? "main",
    working_branch: record.working_branch ?? record.base_branch ?? "main",
    snapshot_id: record.snapshot_id ?? null,
    stop_reason: record.stop_reason ?? null,
    install_log: record.install_log ?? null,
    dev_log: record.dev_log ?? null,
    runtime: record.runtime ?? null,
    terminal_cwd: record.terminal_cwd ?? null,
    // Preserve the three-way undefined / null / string contract on the
    // wire: undefined means "the source SELECT didn't include the
    // column" (legacy/partial query), null means "explicitly repo
    // root", string means a subdirectory. Coercing undefined → null
    // would silently rewrite legacy records as explicit repo-root
    // overrides on the client side.
    root_directory: record.root_directory,
    created_at: record.created_at ?? record.last_active_at ?? now,
    last_active_at: record.last_active_at ?? record.created_at ?? now,
    ...summaries,
  };
}
