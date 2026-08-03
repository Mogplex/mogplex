import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import type { JobRunRow } from "../../lib/job-run-service";
import type { ObservabilityStatsAggregates } from "../../app/api/observability/stats/route";

async function loadObservabilityStatsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/observability/stats/route");
}

// The row-level aggregation (token breakdown preference, null-cost exclusion,
// sandbox window clamping, limit-event grouping) lives in the
// observability_stats_snapshot RPC now — these tests cover the handler's
// remaining responsibilities: formatting, job-run windowing, and faithful
// propagation of the aggregates.
type StatsOverrides = {
  calls?: Partial<ObservabilityStatsAggregates["calls"]>;
  today?: Partial<ObservabilityStatsAggregates["today"]>;
  sandboxes?: Partial<ObservabilityStatsAggregates["sandboxes"]>;
  dispatch?: Partial<ObservabilityStatsAggregates["dispatch"]>;
  limits?: Partial<ObservabilityStatsAggregates["limits"]>;
  reconciliation_pending?: number;
};

function buildStats(
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

function buildJobRun(
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

test("GET /api/observability/stats formats and propagates the RPC aggregates", async () => {
  const { createObservabilityStatsGetHandler } =
    await loadObservabilityStatsRoute();
  const now = new Date("2026-04-21T15:30:00.000Z");

  const handler = createObservabilityStatsGetHandler({
    requireUserId: async () => "user-123",
    getNow: () => now,
    loadSnapshot: async () => ({
      stats: buildStats({
        calls: {
          total: 3,
          total_tokens: 606_000,
          success: 2,
          avg_duration_ms: 2000.4,
          // Sum of known costs only — null-cost calls are excluded by the
          // RPC, not zero-priced. 3.734 rounds to 3.73 for display.
          known_cost_usd: 3.734,
          by_model: [
            { model: "openai/gpt-5.4-mini", count: 2, tokens: 6000 },
            { model: "unknown-model", count: 1, tokens: 600000 },
          ],
          by_type: [
            { type: "chat", count: 2 },
            { type: "pr_review", count: 1 },
          ],
        },
        today: { calls: 2, tokens: 603_000, known_cost_usd: 1.234 },
        sandboxes: { total: 1, active: 1, window_time_ms: 3_600_000 },
        limits: {
          allowed: 4,
          denied: 1,
          by_route: [{ route_key: "api/chat", allowed: 4, denied: 1 }],
        },
        reconciliation_pending: 3,
      }),
      jobRuns: [],
    }),
    isRepairableJobRun: () => false,
    getJobRunPendingAnchor: () => null,
  });

  const response = await handler();
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.deepEqual(body.summary, {
    total_calls: 3,
    total_tokens: 606000,
    total_cost: 3.73,
    cost_today: 1.23,
    reconciliation_pending: 3,
    avg_duration_ms: 2000,
    success_rate: 66.7,
    calls_today: 2,
    tokens_today: 603000,
    sandbox_time_ms: 3600000,
    sandbox_active: 1,
    sandbox_total: 1,
    job_runs_total: 0,
    job_runs_running: 0,
    job_runs_pending: 0,
    job_runs_stale_pending: 0,
    job_runs_failed_in_range: 0,
    job_runs_repaired_in_range: 0,
    job_runs_concluded_in_range: 0,
    job_runs_success_rate_in_range: null,
    suppressed_in_range: 0,
    deferred_in_range: 0,
    start_failed_in_range: 0,
    limit_allowed_in_range: 4,
    limit_denied_in_range: 1,
    oldest_pending_age_ms: 0,
  });
  assert.deepEqual(body.by_model, [
    { model: "openai/gpt-5.4-mini", count: 2, tokens: 6000 },
    { model: "unknown-model", count: 1, tokens: 600000 },
  ]);
  assert.deepEqual(body.by_type, [
    { type: "chat", count: 2 },
    { type: "pr_review", count: 1 },
  ]);
  assert.deepEqual(body.limits_by_route, [
    { route_key: "api/chat", allowed: 4, denied: 1 },
  ]);
  assert.equal("total_cost_estimate" in body.summary, false);
  assert.equal("cost_today_estimate" in body.summary, false);
});

test("GET /api/observability/stats zeroes rate and duration for an empty window", async () => {
  const { createObservabilityStatsGetHandler } =
    await loadObservabilityStatsRoute();

  const handler = createObservabilityStatsGetHandler({
    requireUserId: async () => "user-123",
    getNow: () => new Date("2026-04-21T15:30:00.000Z"),
    // avg_duration_ms is null when no call carries a duration — the summary
    // must render 0, not NaN, and success_rate must not divide by zero.
    loadSnapshot: async () => ({ stats: buildStats(), jobRuns: [] }),
    isRepairableJobRun: () => false,
    getJobRunPendingAnchor: () => null,
  });

  const response = await handler();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.summary.avg_duration_ms, 0);
  assert.equal(body.summary.success_rate, 0);
  assert.equal(body.summary.total_cost, 0);
});

test("GET /api/observability/stats counts the same repairable pending set used by the Runs filter", async () => {
  const { createObservabilityStatsGetHandler } =
    await loadObservabilityStatsRoute();

  const handler = createObservabilityStatsGetHandler({
    requireUserId: async () => "user-123",
    getNow: () => new Date("2026-04-21T15:30:00.000Z"),
    loadSnapshot: async () => ({
      stats: buildStats(),
      jobRuns: [
        buildJobRun({
          id: "repairable",
          status: "pending",
          last_start_attempt_at: "2026-04-21T12:00:00.000Z",
        }),
        buildJobRun({ id: "waiting", status: "pending" }),
        buildJobRun({ id: "complete", status: "success" }),
      ],
    }),
    isRepairableJobRun: (run) => Boolean(run.last_start_attempt_at),
    getJobRunPendingAnchor: () => null,
  });

  const response = await handler();
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.summary.job_runs_pending, 2);
  assert.equal(body.summary.job_runs_stale_pending, 1);
});

test("GET /api/observability/stats returns auth failures directly", async () => {
  const { createObservabilityStatsGetHandler } =
    await loadObservabilityStatsRoute();

  const handler = createObservabilityStatsGetHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });

  const response = await handler();
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("GET /api/observability/stats forwards from/to query params to the snapshot loader", async () => {
  const { createObservabilityStatsGetHandler } =
    await loadObservabilityStatsRoute();

  let observed: { from?: string; to?: string; nowIso?: string } | null = null;

  const handler = createObservabilityStatsGetHandler({
    requireUserId: async () => "user-456",
    getNow: () => new Date("2026-04-21T15:30:00.000Z"),
    loadSnapshot: async ({ from, to, nowIso }) => {
      observed = { from, to, nowIso };
      return { stats: buildStats(), jobRuns: [] };
    },
    isRepairableJobRun: () => false,
    getJobRunPendingAnchor: () => null,
  });

  const url = new URL(
    "https://example.test/api/observability/stats?from=2026-04-01T00:00:00Z&to=2026-04-15T00:00:00Z"
  );
  const req = {
    nextUrl: { searchParams: url.searchParams },
  } as unknown as Parameters<typeof handler>[0];

  const response = await handler(req);
  assert.equal(response.status, 200);
  assert.deepEqual(observed, {
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-15T00:00:00.000Z",
    nowIso: "2026-04-21T15:30:00.000Z",
  });
});

test("GET /api/observability/stats ignores malformed from/to values", async () => {
  const { createObservabilityStatsGetHandler } =
    await loadObservabilityStatsRoute();

  let observed: { from?: string; to?: string } | null = null;

  const handler = createObservabilityStatsGetHandler({
    requireUserId: async () => "user-789",
    getNow: () => new Date("2026-04-21T15:30:00.000Z"),
    loadSnapshot: async ({ from, to }) => {
      observed = { from, to };
      return { stats: buildStats(), jobRuns: [] };
    },
    isRepairableJobRun: () => false,
    getJobRunPendingAnchor: () => null,
  });

  const url = new URL(
    "https://example.test/api/observability/stats?from=not-a-date&to="
  );
  const req = {
    nextUrl: { searchParams: url.searchParams },
  } as unknown as Parameters<typeof handler>[0];

  await handler(req);
  assert.deepEqual(observed, { from: undefined, to: undefined });
});

test("GET /api/observability/stats success rate counts only terminal runs, excluding pending/running/cancelled", async () => {
  const { createObservabilityStatsGetHandler } =
    await loadObservabilityStatsRoute();
  const now = new Date("2026-04-21T15:30:00.000Z");
  const inWindow = "2026-04-21T12:00:00.000Z"; // within the last 24h
  const beforeWindow = "2026-04-19T12:00:00.000Z"; // older than 24h

  const handler = createObservabilityStatsGetHandler({
    requireUserId: async () => "user-123",
    getNow: () => now,
    loadSnapshot: async () => ({
      stats: buildStats(),
      jobRuns: [
        buildJobRun({ id: "ok-1", status: "success", completed_at: inWindow }),
        buildJobRun({ id: "ok-2", status: "success", completed_at: inWindow }),
        buildJobRun({ id: "ok-3", status: "success", completed_at: inWindow }),
        buildJobRun({ id: "fail-1", status: "failed", completed_at: inWindow }),
        // In-flight and aborted runs in the window must NOT dilute the rate.
        buildJobRun({
          id: "running-1",
          status: "running",
          completed_at: null,
          started_at: inWindow,
        }),
        buildJobRun({
          id: "pending-1",
          status: "pending",
          completed_at: null,
          started_at: null,
          created_at: inWindow,
        }),
        buildJobRun({
          id: "cancelled-1",
          status: "cancelled",
          completed_at: inWindow,
        }),
        // Terminal but older than the window — excluded by time.
        buildJobRun({
          id: "old-success",
          status: "success",
          completed_at: beforeWindow,
          started_at: beforeWindow,
          created_at: beforeWindow,
        }),
      ],
    }),
    isRepairableJobRun: () => false,
    getJobRunPendingAnchor: () => null,
  });

  const response = await handler();
  assert.equal(response.status, 200);
  const body = await response.json();

  // 4 concluded in-window (3 success + 1 failed). running/pending/cancelled and
  // the out-of-window success are all excluded, so the rate is 3/4 = 75% —
  // not the pre-fix 3/7 ≈ 42.9% that counted in-flight/aborted runs.
  assert.equal(body.summary.job_runs_concluded_in_range, 4);
  assert.equal(body.summary.job_runs_success_rate_in_range, 75);
});

test("GET /api/observability/stats windows job-run stats to the from/to range instead of a fixed 24h", async () => {
  const { createObservabilityStatsGetHandler } =
    await loadObservabilityStatsRoute();
  const now = new Date("2026-04-21T15:30:00.000Z");
  const inRange = "2026-04-10T12:00:00.000Z";
  const beforeRange = "2026-03-30T12:00:00.000Z";
  // Inside the last 24h but *outside* the selected range — the pre-fix code
  // counted this because it always anchored on now-24h.
  const last24hOnly = "2026-04-21T10:00:00.000Z";

  const handler = createObservabilityStatsGetHandler({
    requireUserId: async () => "user-123",
    getNow: () => now,
    loadSnapshot: async () => ({
      stats: buildStats(),
      jobRuns: [
        buildJobRun({
          id: "failed-in-range",
          status: "failed",
          started_at: inRange,
          completed_at: inRange,
        }),
        buildJobRun({
          id: "failed-before-range",
          status: "failed",
          started_at: beforeRange,
          created_at: beforeRange,
          completed_at: beforeRange,
        }),
        buildJobRun({
          id: "failed-last-24h-only",
          status: "failed",
          started_at: last24hOnly,
          created_at: last24hOnly,
          completed_at: last24hOnly,
        }),
        buildJobRun({
          id: "success-in-range",
          status: "success",
          started_at: inRange,
          completed_at: inRange,
        }),
        buildJobRun({
          id: "repaired-in-range",
          status: "success",
          started_at: inRange,
          completed_at: inRange,
          last_start_source: "repair",
          last_start_attempt_at: inRange,
        }),
        buildJobRun({
          id: "repaired-before-range",
          status: "success",
          started_at: beforeRange,
          created_at: beforeRange,
          completed_at: beforeRange,
          last_start_source: "repair",
          last_start_attempt_at: beforeRange,
        }),
      ],
    }),
    isRepairableJobRun: () => false,
    getJobRunPendingAnchor: () => null,
  });

  const url = new URL(
    "https://example.test/api/observability/stats?from=2026-04-08T00:00:00Z&to=2026-04-15T00:00:00Z"
  );
  const req = {
    nextUrl: { searchParams: url.searchParams },
  } as unknown as Parameters<typeof handler>[0];

  const response = await handler(req);
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.summary.job_runs_failed_in_range, 1);
  assert.equal(body.summary.job_runs_repaired_in_range, 1);
  // 3 concluded in range: failed-in-range, success-in-range, repaired-in-range.
  assert.equal(body.summary.job_runs_concluded_in_range, 3);
  assert.equal(body.summary.job_runs_success_rate_in_range, 66.7);
  // Snapshot stats stay unwindowed — all 6 runs are visible.
  assert.equal(body.summary.job_runs_total, 6);
});

test("GET /api/observability/stats passes the selected window to the snapshot loader and defaults to last 24h", async () => {
  const { createObservabilityStatsGetHandler } =
    await loadObservabilityStatsRoute();
  const now = new Date("2026-04-21T15:30:00.000Z");

  const observed: { windowStartIso?: string; windowEndIso?: string }[] = [];
  const makeHandler = () =>
    createObservabilityStatsGetHandler({
      requireUserId: async () => "user-123",
      getNow: () => now,
      loadSnapshot: async ({ windowStartIso, windowEndIso }) => {
        observed.push({ windowStartIso, windowEndIso });
        return { stats: buildStats(), jobRuns: [] };
      },
      isRepairableJobRun: () => false,
      getJobRunPendingAnchor: () => null,
    });

  const rangedUrl = new URL(
    "https://example.test/api/observability/stats?from=2026-04-08T00:00:00Z&to=2026-04-15T00:00:00Z"
  );
  await makeHandler()({
    nextUrl: { searchParams: rangedUrl.searchParams },
  } as unknown as Parameters<ReturnType<typeof makeHandler>>[0]);
  await makeHandler()();

  assert.deepEqual(observed, [
    {
      windowStartIso: "2026-04-08T00:00:00.000Z",
      windowEndIso: "2026-04-15T00:00:00.000Z",
    },
    {
      // No range given: the window degrades to the historical rolling 24h.
      windowStartIso: "2026-04-20T15:30:00.000Z",
      windowEndIso: undefined,
    },
  ]);
});

test("GET /api/observability/stats surfaces server-side dispatch outcome counts in the summary", async () => {
  const { createObservabilityStatsGetHandler } =
    await loadObservabilityStatsRoute();

  const handler = createObservabilityStatsGetHandler({
    requireUserId: async () => "user-123",
    getNow: () => new Date("2026-04-21T15:30:00.000Z"),
    loadSnapshot: async () => ({
      stats: buildStats({
        dispatch: { suppressed: 7, deferred: 3, start_failed: 2 },
      }),
      jobRuns: [],
    }),
    isRepairableJobRun: () => false,
    getJobRunPendingAnchor: () => null,
  });

  const response = await handler();
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.summary.suppressed_in_range, 7);
  assert.equal(body.summary.deferred_in_range, 3);
  assert.equal(body.summary.start_failed_in_range, 2);
});
