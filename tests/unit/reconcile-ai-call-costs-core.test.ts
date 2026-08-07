import assert from "node:assert/strict";
import test from "node:test";
import {
  loadReconcileModule,
  createRow,
  createReconcileSupabase,
} from "./helpers/reconcile-ai-call-costs-fixtures";

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
      return {
        metered: true,
        reason: "posted",
        amountCents: 8,
        costUnits: 8_340_000,
      };
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

test("does not finalize Gateway cost when token metering cannot find an account", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([createRow()]);
  const capturedExceptions: unknown[] = [];
  const capturedMessages: Array<{
    message: string;
    context: unknown;
  }> = [];

  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    now: () => new Date("2026-05-17T00:00:00.000Z"),
    sentry: {
      captureException: (error) => {
        capturedExceptions.push(error);
        return "event-id";
      },
      captureMessage: (message, context) => {
        capturedMessages.push({ message, context });
        return "event-id";
      },
    },
    gateway: {
      getGenerationInfo: async () => ({ cost: 0.0834 }),
    },
    meterReconciledTokenUsage: async () => ({
      metered: false,
      reason: "no_billing_account",
      amountCents: 0,
      costUnits: 8_340_000,
    }),
  });

  assert.deepEqual(summary, {
    scanned: 1,
    reconciled: 0,
    skipped: 1,
    errored: 0,
  });
  assert.equal(updates.length, 0);
  assert.deepEqual(capturedExceptions, []);
  assert.equal(capturedMessages[0]?.message.includes("billing account"), true);
  assert.deepEqual(
    (capturedMessages[0]?.context as { fingerprint?: string[] }).fingerprint,
    ["ai-cost-reconciliation", "no-billing-account", "call_1"]
  );
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
        id: "gen_old",
        totalCost: 0.12,
      }),
    },
  });

  assert.equal(summary.reconciled, 1);
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
        id: "gen:whatever",
        totalCost: 0.12,
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
