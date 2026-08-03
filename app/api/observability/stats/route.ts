import { NextResponse, type NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getJobRunPendingAnchor, isRepairableJobRun } from "@/lib/job-runs";
import { loadUserJobRuns } from "@/lib/job-run-service";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Shape of the observability_stats_snapshot RPC result. All ai_calls,
// sandboxes, dispatch, and limit_events aggregation happens in Postgres
// (migration 20260731011500) — PostgREST aggregates are disabled on this
// project and row-level fetches truncate at the query cap, so summing in JS
// undercounts once a window exceeds it. Job-run stats stay in TS below
// because they reuse repair/pending-anchor logic shared with other routes.
export type ObservabilityStatsAggregates = {
  calls: {
    total: number;
    total_tokens: number;
    success: number;
    // null when no call in the window carries a duration.
    avg_duration_ms: number | null;
    // Sum over calls with a known cost; null-cost calls contribute nothing
    // rather than being treated as $0-priced.
    known_cost_usd: number;
    by_model: { model: string; count: number; tokens: number }[];
    by_type: { type: string; count: number }[];
  };
  today: { calls: number; tokens: number; known_cost_usd: number };
  sandboxes: { total: number; active: number; window_time_ms: number };
  dispatch: { suppressed: number; deferred: number; start_failed: number };
  limits: {
    allowed: number;
    denied: number;
    by_route: { route_key: string; allowed: number; denied: number }[];
  };
  reconciliation_pending: number;
};

type ObservabilityStatsSnapshot = {
  stats: ObservabilityStatsAggregates;
  jobRuns: Awaited<ReturnType<typeof loadUserJobRuns>>["runs"];
};

type ObservabilityStatsGetDeps = {
  requireUserId: typeof requireUserId;
  loadSnapshot: (args: {
    userId: string;
    todayStartIso: string;
    // Selected range start (falls back to last 24h when no `from` is given).
    windowStartIso: string;
    // Selected range end; undefined means "now" (open-ended).
    windowEndIso?: string;
    nowIso: string;
    // Date (not ISO string) so the value is guaranteed to round-trip through
    // toISOString() before reaching the RPC parameter.
    reconciliationStaleBefore: Date;
    from?: string;
    to?: string;
  }) => Promise<ObservabilityStatsSnapshot>;
  getNow: () => Date;
  getJobRunPendingAnchor: typeof getJobRunPendingAnchor;
  isRepairableJobRun: typeof isRepairableJobRun;
};

const defaultObservabilityStatsGetDeps: ObservabilityStatsGetDeps = {
  requireUserId,
  async loadSnapshot({
    userId,
    todayStartIso,
    windowStartIso,
    windowEndIso,
    nowIso,
    reconciliationStaleBefore,
    from,
    to,
  }) {
    const [statsResult, jobRunsResult] = await Promise.all([
      supabaseAdmin.rpc("observability_stats_snapshot", {
        p_user_id: userId,
        p_calls_from: from ?? null,
        p_calls_to: to ?? null,
        p_today_start: todayStartIso,
        p_window_start: windowStartIso,
        p_window_end: windowEndIso ?? null,
        p_now: nowIso,
        p_reconciliation_stale_before: reconciliationStaleBefore.toISOString(),
      }),
      loadUserJobRuns(userId),
    ]);

    if (statsResult.error) {
      throw new Error(
        `observability stats snapshot RPC failed: ${statsResult.error.message}`
      );
    }

    return {
      stats: statsResult.data as ObservabilityStatsAggregates,
      jobRuns: jobRunsResult.runs,
    };
  },
  getNow: () => new Date(),
  getJobRunPendingAnchor,
  isRepairableJobRun,
};

function normalizeIsoParam(value: string | null): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function roundCost(cost: number) {
  return Math.round(cost * 100) / 100;
}

export function createObservabilityStatsGetHandler(
  overrides: Partial<ObservabilityStatsGetDeps> = {}
) {
  const deps: ObservabilityStatsGetDeps = {
    ...defaultObservabilityStatsGetDeps,
    ...overrides,
  };

  return async function GET(req?: NextRequest) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const now = deps.getNow();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const reconciliationStaleBefore = new Date(now.getTime() - 60 * 60 * 1000);
    const searchParams = req?.nextUrl?.searchParams;
    const fromParam = normalizeIsoParam(searchParams?.get("from") ?? null);
    const toParam = normalizeIsoParam(searchParams?.get("to") ?? null);
    // Every windowed stat (failed/repaired/concluded runs, dispatch and limit
    // events, sandbox time) is anchored to this range. Without an explicit
    // range it degrades to the historical rolling 24h window.
    const windowStartIso =
      fromParam ?? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const windowStartMs = new Date(windowStartIso).getTime();
    const windowEndMs = toParam ? new Date(toParam).getTime() : now.getTime();
    const { stats, jobRuns } = await deps.loadSnapshot({
      userId,
      todayStartIso: todayStart.toISOString(),
      windowStartIso,
      windowEndIso: toParam,
      nowIso: now.toISOString(),
      reconciliationStaleBefore,
      from: fromParam,
      to: toParam,
    });

    const totalCalls = stats.calls.total;

    const isWithinWindow = (when: string | null | undefined) => {
      if (!when) return false;
      const ms = new Date(when).getTime();
      return ms >= windowStartMs && ms <= windowEndMs;
    };

    const totalJobRuns = jobRuns.length;
    const runningJobRuns = jobRuns.filter(
      (run) => run.status === "running"
    ).length;
    const pendingJobRuns = jobRuns.filter(
      (run) => run.status === "pending"
    ).length;
    const repairablePendingJobRuns = jobRuns.filter((run) =>
      deps.isRepairableJobRun(run)
    ).length;
    // "Failed" counts failures that *started* in the window (started_at),
    // which is deliberately a different anchor from the success-rate denominator
    // below (concludedInRange, anchored on completed_at). These answer different
    // questions — "failures that began in the window" vs "verdicts reached in
    // the window" — so a long-running job that started before the window but
    // failed inside it shows up in the rate but not this count. Keep them
    // distinct on purpose.
    const failedJobRunsInRange = jobRuns.filter((run) => {
      if (run.status !== "failed") return false;
      return isWithinWindow(run.started_at || run.created_at);
    }).length;
    const repairedJobRunsInRange = jobRuns.filter((run) => {
      if (run.last_start_source !== "repair") return false;
      return isWithinWindow(run.last_start_attempt_at);
    }).length;
    // Success rate is over runs that reached a terminal verdict in the window.
    // pending/running are still in flight, and cancelled runs are aborted
    // (neither a success nor a failure) — counting any of them in the
    // denominator understates the rate. Anchor on completed_at, the moment the
    // verdict was actually reached.
    const concludedInRange = jobRuns.filter((run) => {
      if (run.status !== "success" && run.status !== "failed") return false;
      return isWithinWindow(
        run.completed_at || run.started_at || run.created_at
      );
    });
    const successfulInRange = concludedInRange.filter(
      (run) => run.status === "success"
    ).length;
    // null (not 0) when nothing concluded in the window, so the UI can render
    // "—" instead of an alarming 0% for an account that simply had no runs.
    const successRateInRange =
      concludedInRange.length > 0
        ? Math.round((successfulInRange / concludedInRange.length) * 1000) / 10
        : null;
    const oldestPendingAgeMs = jobRuns
      .filter((run) => run.status === "pending")
      .map((run) => deps.getJobRunPendingAnchor(run))
      .filter((anchor): anchor is string => typeof anchor === "string")
      .reduce((oldest, anchor) => {
        const age = now.getTime() - new Date(anchor).getTime();
        return oldest === 0 ? age : Math.max(oldest, age);
      }, 0);

    return NextResponse.json({
      summary: {
        total_calls: totalCalls,
        total_tokens: stats.calls.total_tokens,
        total_cost: roundCost(stats.calls.known_cost_usd),
        cost_today: roundCost(stats.today.known_cost_usd),
        reconciliation_pending: stats.reconciliation_pending,
        avg_duration_ms: Math.round(stats.calls.avg_duration_ms ?? 0),
        success_rate:
          totalCalls > 0
            ? Math.round((stats.calls.success / totalCalls) * 1000) / 10
            : 0,
        calls_today: stats.today.calls,
        tokens_today: stats.today.tokens,
        sandbox_time_ms: stats.sandboxes.window_time_ms,
        sandbox_active: stats.sandboxes.active,
        sandbox_total: stats.sandboxes.total,
        job_runs_total: totalJobRuns,
        job_runs_running: runningJobRuns,
        job_runs_pending: pendingJobRuns,
        // The response key is retained for compatibility; this is the same
        // repairability predicate used by the Runs `only_repairable` filter.
        job_runs_stale_pending: repairablePendingJobRuns,
        job_runs_failed_in_range: failedJobRunsInRange,
        job_runs_repaired_in_range: repairedJobRunsInRange,
        job_runs_concluded_in_range: concludedInRange.length,
        job_runs_success_rate_in_range: successRateInRange,
        suppressed_in_range: stats.dispatch.suppressed,
        deferred_in_range: stats.dispatch.deferred,
        start_failed_in_range: stats.dispatch.start_failed,
        limit_allowed_in_range: stats.limits.allowed,
        limit_denied_in_range: stats.limits.denied,
        oldest_pending_age_ms: oldestPendingAgeMs,
      },
      by_model: stats.calls.by_model,
      by_type: stats.calls.by_type,
      limits_by_route: stats.limits.by_route,
    });
  };
}

export const GET = createObservabilityStatsGetHandler();
