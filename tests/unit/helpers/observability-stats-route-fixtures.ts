import type { JobRunRow } from "../../../lib/job-run-service";
import type { ObservabilityStatsAggregates } from "../../../app/api/observability/stats/route";

export async function loadObservabilityStatsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/observability/stats/route");
}

// The row-level aggregation (token breakdown preference, null-cost exclusion,
// sandbox window clamping, limit-event grouping) lives in the
// observability_stats_snapshot RPC now — these tests cover the handler's
// remaining responsibilities: formatting, job-run windowing, and faithful
// propagation of the aggregates.
export type StatsOverrides = {
  calls?: Partial<ObservabilityStatsAggregates["calls"]>;
  today?: Partial<ObservabilityStatsAggregates["today"]>;
  sandboxes?: Partial<ObservabilityStatsAggregates["sandboxes"]>;
  dispatch?: Partial<ObservabilityStatsAggregates["dispatch"]>;
  limits?: Partial<ObservabilityStatsAggregates["limits"]>;
  reconciliation_pending?: number;
};

export function buildStats(
  overrides: StatsOverrides = {}
): ObservabilityStatsAggregates {
  return {
    calls: {
      total: 0,
      total_tokens: 0,
      success: 0,
      avg_duration_ms: null,
      known_cost_usd: 0,
      by_model: [],
      by_type: [],
      ...overrides.calls,
    },
    today: {
      calls: 0,
      tokens: 0,
      known_cost_usd: 0,
      ...overrides.today,
    },
    sandboxes: {
      total: 0,
      active: 0,
      window_time_ms: 0,
      ...overrides.sandboxes,
    },
    dispatch: {
      suppressed: 0,
      deferred: 0,
      start_failed: 0,
      ...overrides.dispatch,
    },
    limits: {
      allowed: 0,
      denied: 0,
      by_route: [],
      ...overrides.limits,
    },
    reconciliation_pending: overrides.reconciliation_pending ?? 0,
  };
}

export function buildJobRun(
  overrides: Partial<JobRunRow> & Pick<JobRunRow, "id">
): JobRunRow {
  return {
    assignment_id: null,
    trigger_id: null,
    flow_id: "flow-1",
    flow_version_id: null,
    runtime_provider: null,
    runtime_run_id: null,
    workflow_run_id: null,
    retry_of_job_run_id: null,
    status: "success",
    created_at: "2026-04-21T12:00:00.000Z",
    started_at: "2026-04-21T12:00:00.000Z",
    completed_at: "2026-04-21T12:00:00.000Z",
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    duration_ms: null,
    error: null,
    start_attempts: 0,
    last_start_attempt_at: null,
    last_start_error: null,
    last_start_source: null,
    cancel_requested_at: null,
    cancelled_at: null,
    cancel_reason: null,
    cancel_error: null,
    metadata: null,
    ...overrides,
  };
}
