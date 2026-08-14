import type {
  ObservabilityJobRunAggregates,
  ObservabilityStatsAggregates,
} from "../../../app/api/observability/stats/route";

export async function loadObservabilityStatsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/observability/stats/route");
}

// The row-level aggregation (token breakdown preference, null-cost exclusion,
// sandbox window clamping, limit-event grouping) lives in the
// observability_stats_snapshot RPC now — these tests cover the handler's
// remaining responsibilities: formatting and faithful propagation of the
// aggregates.
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

export function buildJobRunStats(
  overrides: Partial<ObservabilityJobRunAggregates> = {}
): ObservabilityJobRunAggregates {
  return {
    total: 0,
    running: 0,
    pending: 0,
    repairable_pending: 0,
    failed_in_range: 0,
    repaired_in_range: 0,
    concluded_in_range: 0,
    successful_in_range: 0,
    oldest_pending_age_ms: 0,
    ...overrides,
  };
}
