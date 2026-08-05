import assert from "node:assert/strict";
import test from "node:test";
import type { AiCallCostReconciliationRow } from "../../trigger/reconcile-ai-call-costs";

type ReconcileModule = typeof import("../../trigger/reconcile-ai-call-costs");

async function loadReconcileModule(): Promise<ReconcileModule> {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../trigger/reconcile-ai-call-costs");
}

function createRow(
  overrides: Partial<AiCallCostReconciliationRow> = {}
): AiCallCostReconciliationRow {
  return {
    id: "call_1",
    user_id: "user-1",
    model: "anthropic/claude-sonnet-4",
    gateway_generation_id: "gen_x",
    gateway_generation_ids: null,
    cost_source: "trigger",
    completed_at: "2026-05-16T10:00:00.000Z",
    metadata: null,
    ...overrides,
  };
}

function createReconcileSupabase(
  rows: AiCallCostReconciliationRow[],
  options: {
    loadError?: string;
    updateRows?: Array<{ id: string }>;
  } = {}
) {
  const updates: Array<{
    payload: Record<string, unknown>;
    eq: [string, string];
    or: string;
    select: string;
  }> = [];

  const client = {
    from(table: string) {
      assert.equal(table, "ai_calls");
      const state: {
        updatePayload?: Record<string, unknown>;
        eq?: [string, string];
        or?: string;
      } = {};
      const builder = {
        select(columns: string) {
          if (state.updatePayload) {
            updates.push({
              payload: state.updatePayload,
              eq: state.eq!,
              or: state.or!,
              select: columns,
            });
            return Promise.resolve({
              data: options.updateRows ?? [{ id: state.eq![1] }],
              error: null,
            });
          }
          assert.equal(
            columns,
            "id, user_id, model, gateway_generation_id, gateway_generation_ids, cost_source, completed_at, metadata"
          );
          return builder;
        },
        not(column: string, operator: string, value: unknown) {
          assert.deepEqual(
            [column, operator, value],
            ["gateway_generation_id", "is", null]
          );
          return builder;
        },
        isDistinct(column: string, value: string) {
          assert.deepEqual([column, value], ["cost_source", "gateway"]);
          return builder;
        },
        gt(column: string, value: string) {
          assert.equal(column, "completed_at");
          assert.equal(typeof value, "string");
          return builder;
        },
        lt(column: string, value: string) {
          assert.equal(column, "completed_at");
          assert.equal(typeof value, "string");
          return builder;
        },
        order(column: string, options: { ascending: boolean }) {
          assert.equal(column, "completed_at");
          assert.deepEqual(options, { ascending: true });
          return builder;
        },
        limit(limit: number) {
          assert.equal(limit, 500);
          if (options.loadError) {
            return Promise.resolve({
              data: null,
              error: { message: options.loadError },
            });
          }
          return Promise.resolve({ data: rows, error: null });
        },
        update(payload: Record<string, unknown>) {
          state.updatePayload = payload;
          return builder;
        },
        eq(column: string, value: string) {
          state.eq = [column, value];
          return builder;
        },
        or(filter: string) {
          state.or = filter;
          return builder;
        },
      };
      return builder;
    },
  };

  return { client, updates };
}

test("reconciles a trigger-owned row with the full gateway cost contract", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([createRow()]);

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async () => ({
        id: "gen_x",
        cost: 0.0834,
      }),
    },
  });

  assert.deepEqual(summary, {
    scanned: 1,
    reconciled: 1,
    skipped: 0,
    errored: 0,
  });
  assert.deepEqual(updates, [
    {
      payload: {
        cost_usd: 0.0834,
        cost_source: "gateway",
        gateway_generation_id: "gen_x",
        gateway_generation_ids: ["gen_x"],
      },
      eq: ["id", "call_1"],
      or: "cost_source.isdistinct.gateway,gateway_generation_id.isdistinct.gen_x",
      select: "id",
    },
  ]);
});

test("posts the exact Gateway token cost before marking it reconciled", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const events: string[] = [];
  const { client } = createReconcileSupabase([createRow()]);
  const originalFrom = client.from;
  client.from = ((table: string) => {
    const builder = originalFrom(table);
    const originalUpdate = builder.update;
    builder.update = ((payload: Record<string, unknown>) => {
      events.push("persist");
      return originalUpdate(payload);
    }) as typeof builder.update;
    return builder;
  }) as typeof client.from;

  const metered: unknown[] = [];
  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async () => ({ cost: 0.0834 }),
    },
    meterReconciledTokenUsage: async (value) => {
      events.push("debit");
      metered.push(value);
      return { metered: true, reason: "posted", amountCents: 8 };
    },
  });

  assert.equal(summary.reconciled, 1);
  assert.deepEqual(events, ["debit", "persist"]);
  assert.deepEqual(metered, [
    {
      aiCallId: "call_1",
      userId: "user-1",
      model: "anthropic/claude-sonnet-4",
      costUsd: 0.0834,
      completedAt: "2026-05-16T10:00:00.000Z",
      generationIds: ["gen_x"],
      metadata: null,
    },
  ]);
});

test("uses the captured generation id when Gateway cost has no id field", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([createRow()]);

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async () => ({
        cost: 0.0834,
      }),
    },
  });

  assert.equal(summary.reconciled, 1);
  assert.equal(
    updates[0]?.or,
    "cost_source.isdistinct.gateway,gateway_generation_id.isdistinct.gen_x"
  );
});

test("skips an already reconciled row with the same generation id", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase(
    [createRow({ cost_source: "gateway", gateway_generation_id: "gen_x" })],
    { updateRows: [] }
  );
  const capturedMessages: Array<{ message: string; context: unknown }> = [];

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: (message, context) => {
        capturedMessages.push({ message, context });
        return "event-id";
      },
    },
    gateway: {
      getGenerationInfo: async () => ({
        id: "gen_x",
        totalCost: 0.0834,
      }),
    },
  });

  assert.equal(summary.skipped, 1);
  assert.equal(updates.length, 1);
  assert.equal(capturedMessages.length, 1);
  assert.equal(
    capturedMessages[0]?.message,
    "[ai-cost-reconciliation] update guard skipped row"
  );
});

test("refreshes a gateway-owned row using the first captured generation id", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  // W11: We use the first ID from the row's captured array for backward compat.
  // Gateway-returned IDs are not used to update the singleton column.
  const { client, updates } = createReconcileSupabase([
    createRow({ cost_source: "gateway", gateway_generation_id: "gen_old" }),
  ]);

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async () => ({
        id: "gen_old", // Gateway confirms the ID
        totalCost: 0.12,
      }),
    },
  });

  assert.equal(summary.reconciled, 1);
  // The first captured ID is used, which is gen_old (from singleton fallback)
  assert.equal(updates[0]?.payload.gateway_generation_id, "gen_old");
  assert.equal(
    updates[0]?.or,
    "cost_source.isdistinct.gateway,gateway_generation_id.isdistinct.gen_old"
  );
});

test("rejects generation ids with PostgREST filter separators in the update guard", async () => {
  const { persistGatewayAiCallCost } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([]);

  for (const generationId of ["gen_with,separator", "gen.with.dot"]) {
    await assert.rejects(
      persistGatewayAiCallCost(
        { supabase: client as never },
        {
          rowId: "call_1",
          costUsd: 0.12,
          generationId,
          generationIds: [generationId],
        }
      ),
      /Invalid Gateway generation id/
    );
  }

  assert.deepEqual(updates, []);
});

test("reconciles successfully when Gateway returns different id (W11 uses stored ids)", async () => {
  // W11: We no longer use Gateway-returned IDs for the update. We use the row's
  // stored IDs, which are already validated during capture. Gateway-returned IDs
  // are ignored, so invalid returned IDs are no longer an error.
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([createRow()]);

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async () => ({
        id: "gen:whatever", // Gateway returns whatever, we ignore it
        totalCost: 0.12,
      }),
    },
  });

  // Should reconcile successfully using the row's stored gen_x ID
  assert.deepEqual(summary, {
    scanned: 1,
    reconciled: 1,
    skipped: 0,
    errored: 0,
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.payload.gateway_generation_id, "gen_x");
});

test("skips rows when Gateway has no cost yet", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([createRow()]);

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async () => ({ id: "gen_x" }),
    },
  });

  assert.equal(summary.skipped, 1);
  assert.deepEqual(updates, []);
});

test("counts per-row Gateway failures and continues the batch", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([
    createRow({ id: "call_throws", gateway_generation_id: "gen_throws" }),
    createRow({ id: "call_ok", gateway_generation_id: "gen_ok" }),
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
        if (id === "gen_throws") throw new Error("gateway down");
        return { id, totalCost: 0.2 };
      },
    },
  });

  assert.deepEqual(summary, {
    scanned: 2,
    reconciled: 1,
    skipped: 0,
    errored: 1,
  });
  assert.equal(capturedExceptions.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.eq[1], "call_ok");
});

test("drains rows beyond the worker concurrency without skipping", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const rows = Array.from({ length: 25 }, (_, index) =>
    createRow({
      id: `call_${index}`,
      gateway_generation_id: `gen_${index}`,
    })
  );
  const { client, updates } = createReconcileSupabase(rows);
  const seenGenerationIds: string[] = [];

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: () => undefined,
    },
    gateway: {
      getGenerationInfo: async ({ id }) => {
        seenGenerationIds.push(id);
        return { id, totalCost: 0.2 };
      },
    },
  });

  assert.deepEqual(summary, {
    scanned: 25,
    reconciled: 25,
    skipped: 0,
    errored: 0,
  });
  assert.equal(seenGenerationIds.length, 25);
  assert.equal(new Set(seenGenerationIds).size, 25);
  assert.equal(updates.length, 25);
});

test("propagates Supabase load failures for scheduled run visibility", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client } = createReconcileSupabase([], {
    loadError: "connection reset",
  });

  await assert.rejects(
    runAiCallCostReconciliation({
      supabase: client as never,
      now: () => new Date("2026-05-16T11:00:00.000Z"),
      sentry: {
        captureException: () => undefined,
        captureMessage: () => undefined,
      },
      gateway: {
        getGenerationInfo: async () => ({ id: "gen_x", totalCost: 0.2 }),
      },
    }),
    /connection reset/
  );
});

test("captures visibility when the update guard rejects a loaded row", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client } = createReconcileSupabase([createRow()], {
    updateRows: [],
  });
  const capturedMessages: Array<{ message: string; context: unknown }> = [];

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: (message, context) => {
        capturedMessages.push({ message, context });
        return "event-id";
      },
    },
    gateway: {
      getGenerationInfo: async () => ({ id: "gen_x", totalCost: 0.2 }),
    },
  });

  assert.equal(summary.skipped, 1);
  assert.equal(capturedMessages.length, 1);
  assert.equal(
    capturedMessages[0]?.message,
    "[ai-cost-reconciliation] update guard skipped row"
  );
  assert.match(JSON.stringify(capturedMessages[0]?.context), /call_1/);
});

test("captures a Sentry warning for stale rows that still have no Gateway cost", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client } = createReconcileSupabase([
    createRow({ completed_at: "2026-05-15T21:59:00.000Z" }),
  ]);
  const capturedMessages: Array<{ message: string; context: unknown }> = [];

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: () => undefined,
      captureMessage: (message, context) => {
        capturedMessages.push({ message, context });
        return "event-id";
      },
    },
    gateway: {
      getGenerationInfo: async () => ({ id: "gen_x" }),
    },
  });

  assert.equal(summary.skipped, 1);
  assert.equal(capturedMessages.length, 1);
  assert.equal(
    capturedMessages[0]?.message,
    "[ai-cost-reconciliation] row still unreconciled"
  );
});

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
