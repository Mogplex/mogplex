import { getJobRunSourceKind } from "@/lib/job-runs";
import type { JobRunControlRow } from "./job-run-cancel-types";

export function coerceJobRunControlRow(row: unknown) {
  return row as JobRunControlRow | null;
}

export function getCancelledDurationMs(
  run: Pick<JobRunControlRow, "started_at" | "duration_ms">,
  _cancelledAt: string
) {
  if (run.started_at) {
    return Math.max(0, Date.now() - new Date(run.started_at).getTime());
  }

  return run.duration_ms ?? null;
}

export function getJobRunControlFlowVersionId(
  run: Pick<JobRunControlRow, "flow_version_id" | "metadata">
) {
  return typeof run.flow_version_id === "string"
    ? run.flow_version_id
    : typeof run.metadata?.flow_version_id === "string"
      ? run.metadata.flow_version_id
      : null;
}

export function getJobRunControlRepoId(
  run: Pick<JobRunControlRow, "metadata">
) {
  return typeof run.metadata?.repo_id === "string"
    ? run.metadata.repo_id
    : null;
}

export function getJobRunControlInstallationId(
  run: Pick<JobRunControlRow, "metadata">
) {
  const raw = run.metadata?.installation_id;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.length > 0) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function getJobRunControlSourceType(
  run: Pick<
    JobRunControlRow,
    | "metadata"
    | "flow_id"
    | "trigger_id"
    | "assignment_id"
    | "retry_of_job_run_id"
  >
) {
  if (
    typeof run.metadata?.source_type === "string" &&
    run.metadata.source_type.length > 0
  ) {
    return run.metadata.source_type;
  }

  const sourceKind = getJobRunSourceKind(run);
  if (sourceKind === "manual_retry") return "manual_retry";
  if (sourceKind === "flow") return "flow";
  if (sourceKind === "trigger") return "trigger";
  return "assignment";
}

export function canFinalizeCancelledStatus(status: JobRunControlRow["status"]) {
  return status === "pending" || status === "running";
}
