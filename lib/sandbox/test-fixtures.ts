import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import type { SandboxRecord, StopReason } from "@/lib/types";

export function sandboxRecord(
  overrides: {
    status?: string;
    healthStatus?: SandboxHealthStatus;
    previewUrl?: string | null;
    snapshotId?: string | null;
    workingBranch?: string;
    stopReason?: StopReason | null;
    persistent?: boolean | null;
    displayError?: string | null;
    rootDirectory?: string | null;
    diagnosticsState?:
      | "building"
      | "build_failed"
      | "deployment_missing"
      | "inaccessible"
      | "platform_not_configured";
  } = {}
): SandboxRecord {
  return {
    id: "record-1",
    user_id: "user-1",
    repo_id: "repo-1",
    sandbox_id: "sandbox-1",
    base_branch: "main",
    working_branch: overrides.workingBranch ?? "feature/chip",
    root_directory: overrides.rootDirectory ?? null,
    snapshot_id: overrides.snapshotId ?? null,
    stop_reason: overrides.stopReason ?? null,
    created_at: "2026-05-13T12:00:00.000Z",
    last_active_at: "2026-05-13T12:00:00.000Z",
    billing_summary: {
      source: "platform",
      label: "Platform",
      project_id: null,
      team_id: null,
      team_label: "Platform",
    },
    runtime_summary: {
      sandbox_id: "sandbox-1",
      status: overrides.status ?? "running",
      health_status: overrides.healthStatus ?? "running",
      preview_url: overrides.previewUrl ?? "https://preview.example",
      last_health_check_at: null,
      last_preview_http_status: null,
      boot_attempts: 1,
      last_boot_started_at: null,
      last_boot_completed_at: null,
      effective_timeout_ms: 3_600_000,
      persistent: overrides.persistent ?? false,
      vercel_diagnostics: overrides.diagnosticsState
        ? {
            state: overrides.diagnosticsState,
            deploymentId: null,
            deploymentStatus: null,
            deploymentUrl: null,
            buildSummary: null,
            detectedAt: null,
          }
        : null,
    },
    error_summary: {
      current_error: null,
      last_preview_error: null,
      last_boot_error: null,
      display_error: overrides.displayError ?? null,
      has_errors: Boolean(overrides.displayError),
    },
  };
}
