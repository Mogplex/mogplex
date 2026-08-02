import { STALE_PENDING_JOB_THRESHOLD_MS } from "@/lib/workflows/job-run-repair";

export const JOB_RUN_START_SOURCES = [
  "webhook",
  "cron",
  "repair",
  "manual_retry",
  "queue_release",
  "api",
] as const;

export type JobRunStartSource = (typeof JOB_RUN_START_SOURCES)[number];
export type JobRunSourceKind =
  | "trigger"
  | "flow"
  | "assignment"
  | "manual_retry";

type JobRunTimingFields = {
  created_at?: string | null;
  started_at?: string | null;
  last_start_attempt_at?: string | null;
};

type JobRunStateFields = JobRunTimingFields & {
  status: string | null;
  trigger_id?: string | null;
  flow_id?: string | null;
  retry_of_job_run_id?: string | null;
  cancel_requested_at?: string | null;
  cancelled_at?: string | null;
};

export function getJobRunSourceKind(
  run: Pick<JobRunStateFields, "trigger_id" | "flow_id" | "retry_of_job_run_id">
): JobRunSourceKind {
  if (run.retry_of_job_run_id) return "manual_retry";
  if (run.flow_id) return "flow";
  return run.trigger_id ? "trigger" : "assignment";
}

export function getJobRunPendingAnchor(run: JobRunTimingFields): string | null {
  return run.last_start_attempt_at || run.created_at || run.started_at || null;
}

export function isRepairableJobRun(
  run: JobRunStateFields,
  now = Date.now(),
  staleThresholdMs = STALE_PENDING_JOB_THRESHOLD_MS
) {
  if (run.status !== "pending") return false;

  const anchor = getJobRunPendingAnchor(run);
  if (!anchor) return true;

  return now - new Date(anchor).getTime() >= staleThresholdMs;
}

export function isRequeueableJobRun(run: Pick<JobRunStateFields, "status">) {
  return run.status === "failed";
}

export function isCancelableJobRun(
  run: Pick<
    JobRunStateFields,
    "status" | "cancel_requested_at" | "cancelled_at"
  >
) {
  if (run.cancel_requested_at || run.cancelled_at) return false;
  return run.status === "pending" || run.status === "running";
}

export function summarizeEntityJobRuns<
  T extends {
    id: string;
    status: string | null;
    error?: string | null;
    started_at?: string | null;
    created_at?: string | null;
    last_start_attempt_at?: string | null;
    cancel_requested_at?: string | null;
    cancelled_at?: string | null;
  },
>(runs: T[], now = Date.now()) {
  const lastRun =
    [...runs].sort((a, b) => {
      const aTime = new Date(a.started_at || a.created_at || 0).getTime();
      const bTime = new Date(b.started_at || b.created_at || 0).getTime();
      return bTime - aTime;
    })[0] || null;

  const failedCutoff = now - 24 * 60 * 60 * 1000;
  const failed24h = runs.filter((run) => {
    if (run.status !== "failed") return false;
    const when = run.started_at || run.created_at;
    return when ? new Date(when).getTime() >= failedCutoff : false;
  }).length;

  return {
    last_job_run_id: lastRun?.id ?? null,
    last_run_status: lastRun?.status ?? null,
    last_run_started_at: lastRun?.started_at || lastRun?.created_at || null,
    last_run_error: lastRun?.error ?? null,
    running_count: runs.filter((run) => run.status === "running").length,
    pending_count: runs.filter((run) => run.status === "pending").length,
    failed_24h: failed24h,
    last_run_repairable: lastRun ? isRepairableJobRun(lastRun, now) : false,
    last_run_requeueable: lastRun ? isRequeueableJobRun(lastRun) : false,
    last_run_cancelable: lastRun ? isCancelableJobRun(lastRun) : false,
  };
}
