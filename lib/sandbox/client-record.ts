import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import type {
  SandboxLifecycleStatus,
  SandboxRecord,
  SandboxRecordRow,
} from "@/lib/types";

export type SandboxRecordPatch = Partial<SandboxRecordRow> &
  Pick<SandboxRecordRow, "id"> & {
    repo_id?: string;
  };

export function toSandboxRecord(
  record: SandboxRecordRow | SandboxRecord
): SandboxRecord {
  if (
    "billing_summary" in record &&
    "runtime_summary" in record &&
    "error_summary" in record
  ) {
    return {
      id: record.id,
      user_id: record.user_id,
      repo_id: record.repo_id,
      sandbox_id: record.sandbox_id,
      base_branch: record.base_branch,
      working_branch: record.working_branch,
      snapshot_id: record.snapshot_id ?? null,
      stop_reason: record.stop_reason ?? null,
      install_log: record.install_log ?? null,
      dev_log: record.dev_log ?? null,
      runtime: record.runtime ?? null,
      terminal_cwd: record.terminal_cwd ?? null,
      root_directory: record.root_directory,
      created_at: record.created_at,
      last_active_at: record.last_active_at,
      billing_summary: record.billing_summary,
      runtime_summary: record.runtime_summary,
      error_summary: record.error_summary,
    };
  }

  return toSandboxClientRecord(record);
}

export function mergeSandboxRecord(
  existing: SandboxRecord | null | undefined,
  incoming: SandboxRecordPatch,
  repoId: string
): SandboxRecord {
  const now = new Date().toISOString();

  const merged: SandboxRecordRow = {
    id: incoming.id,
    user_id: incoming.user_id ?? existing?.user_id ?? "",
    repo_id: repoId,
    sandbox_id: incoming.sandbox_id ?? existing?.sandbox_id ?? "pending",
    base_branch: incoming.base_branch ?? existing?.base_branch ?? "main",
    working_branch:
      incoming.working_branch ??
      existing?.working_branch ??
      incoming.base_branch ??
      existing?.base_branch ??
      "main",
    limit_claim_id: incoming.limit_claim_id ?? null,
    vercel_team_id:
      incoming.vercel_team_id ?? existing?.billing_summary.team_id ?? null,
    vercel_project_id:
      incoming.vercel_project_id ??
      existing?.billing_summary.project_id ??
      null,
    sandbox_billing_target:
      incoming.sandbox_billing_target ??
      (existing?.billing_summary.team_id ? "team" : "personal"),
    billing_source:
      incoming.billing_source ?? existing?.billing_summary.source ?? null,
    billing_team_id:
      incoming.billing_team_id ?? existing?.billing_summary.team_id ?? null,
    billing_project_id:
      incoming.billing_project_id ??
      existing?.billing_summary.project_id ??
      null,
    status: (incoming.status ??
      existing?.runtime_summary.status ??
      "creating") as SandboxLifecycleStatus,
    preview_url:
      "preview_url" in incoming
        ? (incoming.preview_url ?? null)
        : (existing?.runtime_summary.preview_url ?? null),
    snapshot_id: incoming.snapshot_id ?? existing?.snapshot_id ?? null,
    stop_reason:
      "stop_reason" in incoming
        ? (incoming.stop_reason ?? null)
        : (existing?.stop_reason ?? null),
    install_log: incoming.install_log ?? existing?.install_log ?? null,
    dev_log: incoming.dev_log ?? existing?.dev_log ?? null,
    health_status: (incoming.health_status ??
      existing?.runtime_summary.health_status ??
      "starting") as SandboxHealthStatus,
    last_health_check_at:
      incoming.last_health_check_at ??
      existing?.runtime_summary.last_health_check_at ??
      null,
    last_preview_http_status:
      incoming.last_preview_http_status ??
      existing?.runtime_summary.last_preview_http_status ??
      null,
    last_preview_error:
      "last_preview_error" in incoming
        ? (incoming.last_preview_error ?? null)
        : (existing?.error_summary.last_preview_error ?? null),
    last_boot_error:
      "last_boot_error" in incoming
        ? (incoming.last_boot_error ?? null)
        : (existing?.error_summary.last_boot_error ?? null),
    boot_attempts:
      incoming.boot_attempts ?? existing?.runtime_summary.boot_attempts ?? 0,
    last_boot_started_at:
      incoming.last_boot_started_at ??
      existing?.runtime_summary.last_boot_started_at ??
      null,
    last_boot_completed_at:
      incoming.last_boot_completed_at ??
      existing?.runtime_summary.last_boot_completed_at ??
      null,
    runtime: incoming.runtime ?? existing?.runtime ?? null,
    terminal_cwd: incoming.terminal_cwd ?? existing?.terminal_cwd ?? null,
    root_directory:
      "root_directory" in incoming
        ? (incoming.root_directory ?? null)
        : (existing?.root_directory ?? null),
    exec_lock_token: incoming.exec_lock_token ?? null,
    exec_lock_started_at: incoming.exec_lock_started_at ?? null,
    error:
      "error" in incoming
        ? (incoming.error ?? null)
        : (existing?.error_summary.current_error ?? null),
    created_at: incoming.created_at ?? existing?.created_at ?? now,
    last_active_at: incoming.last_active_at ?? existing?.last_active_at ?? now,
  };

  return toSandboxClientRecord(merged);
}
