import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  STALE_RUNNING_JOB_THRESHOLD_MS,
  isStaleRunningJob,
} from "@/lib/workflows/job-run-repair";
import { cancelAutomationJobRun } from "@/lib/workflows/job-run-cancel";
import {
  type ZombieReaperTableSummary,
  ZOMBIE_REAPED_CANCEL_REASON,
  safeAgeMs,
} from "./zombie-reaper-types";

type JobRunZombieRow = {
  id: string;
  status: string | null;
  started_at: string | null;
  created_at: string | null;
};

export async function reapStaleJobRuns(): Promise<ZombieReaperTableSummary> {
  const summary: ZombieReaperTableSummary = {
    table: "job_runs",
    scanned: 0,
    reaped: 0,
    results: [],
    error: null,
  };

  const now = Date.now();
  const coarseCutoffIso = new Date(
    now - STALE_RUNNING_JOB_THRESHOLD_MS
  ).toISOString();

  // OR fallback for null started_at: isStaleRunningJob falls back to
  // created_at when the row never recorded its start. A SQL filter that
  // only looked at started_at would silently exclude those rows because
  // NULL < timestamp is always false in Postgres.
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select("id, status, started_at, created_at")
    .eq("status", "running")
    .or(
      `started_at.lt.${coarseCutoffIso},and(started_at.is.null,created_at.lt.${coarseCutoffIso})`
    )
    .order("started_at", { ascending: true, nullsFirst: false })
    .limit(100);

  if (error) {
    summary.error = error.message;
    return summary;
  }

  const candidates = (data ?? []) as JobRunZombieRow[];
  summary.scanned = candidates.length;

  for (const row of candidates) {
    if (!isStaleRunningJob(row, now)) continue;

    const ageMs = safeAgeMs(row.started_at || row.created_at, now);

    try {
      const result = await cancelAutomationJobRun(
        row.id,
        ZOMBIE_REAPED_CANCEL_REASON
      );

      if (!result.ok) {
        console.warn("[zombie-reaper] cancelAutomationJobRun rejected", {
          jobRunId: row.id,
          status: "status" in result ? result.status : null,
          notFound: result.notFound,
        });
        continue;
      }

      summary.reaped += 1;
      summary.results.push({
        table: "job_runs",
        id: row.id,
        ageMs,
        action: "cancelled",
        detail: ZOMBIE_REAPED_CANCEL_REASON,
      });
    } catch (cancelError) {
      // cancelAutomationJobRun can throw mid-cascade, leaving the
      // job_run in cancel_requested state with a cancel_error. The
      // existing reconcileAutomationJobRuns reconciler will
      // self-heal those rows on its next pass, but ops still need a
      // signal that this happened — log to console.error AND surface
      // a Sentry warning so the partial state isn't silently lost.
      const message =
        cancelError instanceof Error
          ? cancelError.message
          : String(cancelError);
      console.error("[zombie-reaper] failed to cancel stale job_run", {
        jobRunId: row.id,
        error: message,
        ageMs,
      });
      try {
        Sentry.captureMessage(
          "[zombie-reaper] cancelAutomationJobRun threw mid-cascade",
          {
            level: "warning",
            tags: { table: "job_runs" },
            extra: { jobRunId: row.id, error: message, ageMs },
          }
        );
      } catch (captureError) {
        console.error(
          "[zombie-reaper] sentry capture for cancel failure failed",
          captureError
        );
      }
    }
  }

  return summary;
}
