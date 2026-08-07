import assert from "node:assert/strict";
import test from "node:test";
import {
  loadReconcileModule,
  createRow,
  createReconcileSupabase,
} from "./helpers/reconcile-ai-call-costs-fixtures";

// W11: Multi-ID reconciliation tests

test("sums cost across multiple gateway generation IDs (W11)", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([
    createRow({
      gateway_generation_id: "gen_step1",
      gateway_generation_ids: ["gen_step1", "gen_step2", "gen_step3"],
    }),
  ]);

  const gatewayCosts: Record<string, number> = {
    gen_step1: 0.05,
    gen_step2: 0.08,
    gen_step3: 0.04,
  };

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async ({ id }) => ({
        id,
        totalCost: gatewayCosts[id] ?? 0,
      }),
    },
  });

  assert.deepEqual(summary, {
    scanned: 1,
    reconciled: 1,
    skipped: 0,
    errored: 0,
  });
  assert.equal(updates.length, 1);
  // Total cost should be sum of all 3 steps: 0.05 + 0.08 + 0.04 = 0.17
  // Use epsilon comparison to handle floating-point precision
  const cost = updates[0]?.payload.cost_usd as number;
  assert.ok(Math.abs(cost - 0.17) < 1e-9, `Expected cost ~0.17, got ${cost}`);
  // The first ID should be used for backward compatibility
  assert.equal(updates[0]?.payload.gateway_generation_id, "gen_step1");
});

test("prefers gateway_generation_ids array over singleton when both present", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([
    createRow({
      gateway_generation_id: "gen_singleton",
      gateway_generation_ids: ["gen_array1", "gen_array2"],
    }),
  ]);

  const queriedIds: string[] = [];

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async ({ id }) => {
        queriedIds.push(id);
        return { id, totalCost: 0.1 };
      },
    },
  });

  assert.equal(summary.reconciled, 1);
  // Should query the array IDs, not the singleton
  assert.deepEqual(queriedIds, ["gen_array1", "gen_array2"]);
  // Sum of 2 IDs at 0.1 each = 0.2
  assert.equal(updates[0]?.payload.cost_usd, 0.2);
  assert.equal(updates[0]?.payload.gateway_generation_id, "gen_array1");
});

test("falls back to singleton when array is null", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([
    createRow({
      gateway_generation_id: "gen_singleton",
      gateway_generation_ids: null,
    }),
  ]);

  const queriedIds: string[] = [];

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async ({ id }) => {
        queriedIds.push(id);
        return { id, totalCost: 0.15 };
      },
    },
  });

  assert.equal(summary.reconciled, 1);
  assert.deepEqual(queriedIds, ["gen_singleton"]);
  assert.equal(updates[0]?.payload.cost_usd, 0.15);
});

test("falls back to singleton when array is empty", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client } = createReconcileSupabase([
    createRow({
      gateway_generation_id: "gen_singleton",
      gateway_generation_ids: [],
    }),
  ]);

  const queriedIds: string[] = [];

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async ({ id }) => {
        queriedIds.push(id);
        return { id, totalCost: 0.15 };
      },
    },
  });

  assert.equal(summary.reconciled, 1);
  assert.deepEqual(queriedIds, ["gen_singleton"]);
});

test("skips singleton fallback row when gateway has no cost yet (anyMissingCost branch)", async () => {
  // Verify that legacy rows (gateway_generation_ids: null, single gateway_generation_id)
  // with no-cost response also skip correctly, not just multi-ID rows.
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([
    createRow({
      gateway_generation_id: "gen_singleton",
      gateway_generation_ids: null,
    }),
  ]);

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async ({ id }) => ({ id }), // No cost field
    },
  });

  // Should skip until the singleton ID has cost data
  assert.equal(summary.skipped, 1);
  assert.equal(summary.reconciled, 0);
  assert.equal(updates.length, 0);
});

test("counts errored when one of multiple IDs throws a non-404 gateway error (W11)", async () => {
  // Verify that non-404 errors on multi-ID rows are correctly counted as errored,
  // not reconciled or skipped. The Promise.allSettled + re-throw pattern should
  // propagate the error to reconcileAiCallCostRow which logs to Sentry.
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([
    createRow({
      gateway_generation_ids: ["gen_ok", "gen_500"],
    }),
  ]);
  const capturedExceptions: unknown[] = [];

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: (error) => {
        capturedExceptions.push(error);
        return "event-id";
      },
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async ({ id }) => {
        if (id === "gen_500") {
          throw new Error("internal server error");
        }
        return { id, totalCost: 0.05 };
      },
    },
  });

  assert.equal(summary.errored, 1);
  assert.equal(summary.reconciled, 0);
  assert.equal(capturedExceptions.length, 1);
  assert.equal(updates.length, 0);
});

test("skips row when any gateway ID returns 404 (incomplete data)", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([
    createRow({
      gateway_generation_ids: ["gen_ok", "gen_missing", "gen_ok2"],
    }),
  ]);

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async ({ id }) => {
        if (id === "gen_missing") {
          const error = new Error("Not found") as Error & {
            statusCode: number;
          };
          error.statusCode = 404;
          throw error;
        }
        return { id, totalCost: 0.1 };
      },
    },
  });

  assert.equal(summary.skipped, 1);
  assert.equal(updates.length, 0);
});

test("skips reconciliation when any ID has no cost yet (waits for all IDs to be ready)", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([
    createRow({
      gateway_generation_ids: ["gen_with_cost", "gen_no_cost"],
    }),
  ]);

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async ({ id }) => {
        if (id === "gen_no_cost") {
          return { id }; // No cost field - billing not yet finalized
        }
        return { id, totalCost: 0.12 };
      },
    },
  });

  // Should skip until ALL IDs have cost data to avoid partial sums
  assert.equal(summary.skipped, 1);
  assert.equal(summary.reconciled, 0);
  assert.equal(updates.length, 0);
});

test("skips row when all IDs have no cost yet", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([
    createRow({
      gateway_generation_ids: ["gen_no_cost1", "gen_no_cost2"],
    }),
  ]);

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async ({ id }) => ({ id }), // No cost field
    },
  });

  assert.equal(summary.skipped, 1);
  assert.equal(updates.length, 0);
});

test("reconcileAiCallCostRow unit test: handles gateway-owned row with multi-ID array", async () => {
  // Unit test for reconcileAiCallCostRow in isolation. This row with cost_source='gateway'
  // would be filtered out by loadAiCallCostReconciliationRows in production (via
  // .isDistinct("cost_source", "gateway")), but we test the function directly to verify
  // the update guard and cost summation logic work correctly for such rows.
  // This matters for potential future backfill scenarios or query filter changes.
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([
    createRow({
      cost_source: "gateway",
      gateway_generation_id: "gen_step1",
      gateway_generation_ids: ["gen_step1", "gen_step2"],
    }),
  ]);

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async ({ id }) => {
        // Simulate updated cost data from gateway
        const costs: Record<string, number> = {
          gen_step1: 0.1,
          gen_step2: 0.15,
        };
        return { id, totalCost: costs[id] ?? 0 };
      },
    },
  });

  assert.equal(summary.reconciled, 1);
  assert.equal(updates.length, 1);
  // Sum of both steps
  const cost = updates[0]?.payload.cost_usd as number;
  assert.ok(Math.abs(cost - 0.25) < 1e-9, `Expected cost ~0.25, got ${cost}`);
  // First ID from array used for backward compat
  assert.equal(updates[0]?.payload.gateway_generation_id, "gen_step1");
});
