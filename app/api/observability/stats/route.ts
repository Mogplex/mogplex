import { NextResponse, type NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { STALE_PENDING_JOB_THRESHOLD_MS } from "@/lib/workflows/job-run-repair";

// Shape of the observability_stats_snapshot RPC result. All ai_calls,
// sandboxes, dispatch, and limit_events aggregation happens in Postgres
// (migration 20260731011500) — PostgREST aggregates are disabled on this
// project and row-level fetches truncate at the query cap, so summing in JS
// undercounts once a window exceeds it. Job-run aggregation lives in the
// observability_job_run_stats RPC so large histories do not require paginated
// row transfers.
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

export type ObservabilityJobRunAggregates = {
  total: number;
  running: number;
  pending: number;
  repairable_pending: number;
  failed_in_range: number;
  repaired_in_range: number;
  concluded_in_range: number;
  successful_in_range: number;
  oldest_pending_age_ms: number;
};

type ObservabilityStatsSnapshot = {
  stats: ObservabilityStatsAggregates;
  jobRuns: ObservabilityJobRunAggregates;
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
    repairableBeforeIso: string;
    // Date (not ISO string) so the value is guaranteed to round-trip through
    // toISOString() before reaching the RPC parameter.
    reconciliationStaleBefore: Date;
    from?: string;
    to?: string;
  }) => Promise<ObservabilityStatsSnapshot>;
  getNow: () => Date;
};

const defaultObservabilityStatsGetDeps: ObservabilityStatsGetDeps = {
  requireUserId,
  async loadSnapshot({
    userId,
    todayStartIso,
    windowStartIso,
    windowEndIso,
    nowIso,
    repairableBeforeIso,
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
      supabaseAdmin.rpc("observability_job_run_stats", {
        p_user_id: userId,
        p_window_start: windowStartIso,
        p_window_end: windowEndIso ?? nowIso,
        p_now: nowIso,
        p_repairable_before: repairableBeforeIso,
      }),
    ]);

    if (statsResult.error) {
      throw new Error(
        `observability stats snapshot RPC failed: ${statsResult.error.message}`
      );
    }
    if (jobRunsResult.error) {
      throw new Error(
        `observability job-run stats RPC failed: ${jobRunsResult.error.message}`
      );
    }

    return {
      stats: statsResult.data as ObservabilityStatsAggregates,
      jobRuns: jobRunsResult.data as ObservabilityJobRunAggregates,
    };
  },
  getNow: () => new Date(),
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
    const { stats, jobRuns } = await deps.loadSnapshot({
      userId,
      todayStartIso: todayStart.toISOString(),
      windowStartIso,
      windowEndIso: toParam,
      nowIso: now.toISOString(),
      repairableBeforeIso: new Date(
        now.getTime() - STALE_PENDING_JOB_THRESHOLD_MS
      ).toISOString(),
      reconciliationStaleBefore,
      from: fromParam,
      to: toParam,
    });

    const totalCalls = stats.calls.total;
    // null (not 0) when nothing concluded in the window, so the UI can render
    // "—" instead of an alarming 0% for an account that simply had no runs.
    const successRateInRange =
      jobRuns.concluded_in_range > 0
        ? Math.round(
            (jobRuns.successful_in_range / jobRuns.concluded_in_range) * 1000
          ) / 10
        : null;

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
        job_runs_total: jobRuns.total,
        job_runs_running: jobRuns.running,
        job_runs_pending: jobRuns.pending,
        // The response key is retained for compatibility; this is the same
        // repairability predicate used by the Runs `only_repairable` filter.
        job_runs_stale_pending: jobRuns.repairable_pending,
        job_runs_failed_in_range: jobRuns.failed_in_range,
        job_runs_repaired_in_range: jobRuns.repaired_in_range,
        job_runs_concluded_in_range: jobRuns.concluded_in_range,
        job_runs_success_rate_in_range: successRateInRange,
        suppressed_in_range: stats.dispatch.suppressed,
        deferred_in_range: stats.dispatch.deferred,
        start_failed_in_range: stats.dispatch.start_failed,
        limit_allowed_in_range: stats.limits.allowed,
        limit_denied_in_range: stats.limits.denied,
        oldest_pending_age_ms: jobRuns.oldest_pending_age_ms,
      },
      by_model: stats.calls.by_model,
      by_type: stats.calls.by_type,
      limits_by_route: stats.limits.by_route,
    });
  };
}

export const GET = createObservabilityStatsGetHandler();
