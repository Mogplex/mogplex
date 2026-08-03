// Quoted as "2 minutes" in observability tooltip copy — update
// observability-summary.tsx if this changes.
export const STALE_PENDING_JOB_THRESHOLD_MS = 2 * 60 * 1000;

/**
 * Upper bound for a legitimately-running automation job. Trigger.dev
 * tasks self-heartbeat and we already have idle/exec timeouts at the
 * sandbox layer, so anything still in `running` past this window is a
 * zombie — almost always because the Trigger run died (deploy, OOM,
 * platform incident) without writing back its terminal status.
 *
 * Six hours matches ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS in
 * lib/interactive-runs.ts so the UI presenter and the zombie reaper
 * agree on what counts as "live but maybe dying".
 */
export const STALE_RUNNING_JOB_THRESHOLD_MS = 6 * 60 * 60 * 1000;

type RepairableJob = {
  status: string | null;
  last_start_attempt_at?: string | null;
  created_at?: string | null;
  started_at?: string | null;
};

export function isRepairablePendingJob(
  job: RepairableJob,
  now = Date.now(),
  staleThresholdMs = STALE_PENDING_JOB_THRESHOLD_MS
) {
  if (job.status !== "pending") return false;
  const anchor = job.last_start_attempt_at || job.created_at || job.started_at;
  if (!anchor) return true;

  return now - new Date(anchor).getTime() >= staleThresholdMs;
}

type RunningJob = {
  status: string | null;
  started_at?: string | null;
  created_at?: string | null;
};

export function isStaleRunningJob(
  job: RunningJob,
  now = Date.now(),
  staleThresholdMs = STALE_RUNNING_JOB_THRESHOLD_MS
) {
  if (job.status !== "running") return false;
  const anchor = job.started_at || job.created_at;
  if (!anchor) return false;
  return now - new Date(anchor).getTime() >= staleThresholdMs;
}
