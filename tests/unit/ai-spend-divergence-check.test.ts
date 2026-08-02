import assert from "node:assert/strict";
import test from "node:test";

type SpendModule = typeof import("../../trigger/ai-spend-divergence-check");

async function loadSpendModule(): Promise<SpendModule> {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../trigger/ai-spend-divergence-check");
}

function createSpendSupabase(
  total: number | string | null,
  options: { error?: string } = {}
) {
  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const result = options.error
    ? { data: null, error: { message: options.error } }
    : { data: total, error: null };
  const client = {
    rpc(fn: string, params: Record<string, unknown>) {
      rpcCalls.push({ fn, params });
      return Promise.resolve(result);
    },
  };

  return { client, rpcCalls };
}

test("does not capture Sentry when local cost is within five percent of Gateway", async () => {
  const { runAiSpendDivergenceCheck } = await loadSpendModule();
  const { client, rpcCalls } = createSpendSupabase(97);
  const captured: unknown[] = [];
  const gatewayParams: unknown[] = [];

  const summary = await runAiSpendDivergenceCheck({
    supabase: client as never,
    now: () => new Date("2026-05-16T12:00:00.000Z"),
    sentry: {
      captureMessage: (message, context) => {
        captured.push({ message, context });
        return "event-id";
      },
    },
    gateway: {
      getSpendReport: async (params) => {
        gatewayParams.push(params);
        return { results: [{ day: "2026-05-15", totalCost: 100 }] };
      },
    },
  });

  assert.equal(summary.divergent, false);
  assert.equal(summary.skipped, false);
  assert.equal(summary.startDate, "2026-05-15");
  assert.equal(summary.endDate, "2026-05-16");
  assert.equal(captured.length, 0);
  assert.deepEqual(gatewayParams, [
    { startDate: "2026-05-15", endDate: "2026-05-15", groupBy: "day" },
  ]);
  assert.deepEqual(rpcCalls, [
    {
      fn: "sum_ai_call_costs",
      params: {
        p_start: "2026-05-15T00:00:00.000Z",
        p_end: "2026-05-16T00:00:00.000Z",
      },
    },
  ]);
});

test("captures one Sentry warning when Gateway and local totals diverge", async () => {
  const { runAiSpendDivergenceCheck } = await loadSpendModule();
  const { client } = createSpendSupabase(80);
  const captured: Array<{ message: string; context: unknown }> = [];

  const summary = await runAiSpendDivergenceCheck({
    supabase: client as never,
    now: () => new Date("2026-05-16T12:00:00.000Z"),
    sentry: {
      captureMessage: (message, context) => {
        captured.push({ message, context });
        return "event-id";
      },
    },
    gateway: {
      getSpendReport: async () => ({
        results: [
          {
            day: "2026-05-15",
            totalCost: 100,
            provider: "provider-not-forwarded",
          },
        ],
      }),
    },
  });

  assert.equal(summary.divergent, true);
  assert.equal(summary.divergenceRatio, 0.2);
  assert.equal(captured.length, 1);
  assert.equal(
    captured[0]?.message,
    "[ai-spend-divergence] Gateway spend drift"
  );
  assert.match(JSON.stringify(captured[0]?.context), /gateway_total/);
  assert.match(JSON.stringify(captured[0]?.context), /local_total/);
  assert.match(JSON.stringify(captured[0]?.context), /per_day/);
  assert.doesNotMatch(
    JSON.stringify(captured[0]?.context),
    /provider-not-forwarded/
  );
});

test("skips divergence math when Gateway has spend but local cost is zero", async () => {
  const { runAiSpendDivergenceCheck } = await loadSpendModule();
  const { client } = createSpendSupabase(0);
  const captured: Array<{ message: string; context: unknown }> = [];

  const summary = await runAiSpendDivergenceCheck({
    supabase: client as never,
    now: () => new Date("2026-05-16T12:00:00.000Z"),
    sentry: {
      captureMessage: (message, context) => {
        captured.push({ message, context });
        return "event-id";
      },
    },
    gateway: {
      getSpendReport: async () => ({
        results: [{ day: "2026-05-15", totalCost: 100 }],
      }),
    },
  });

  assert.equal(summary.skipped, true);
  assert.equal(summary.gatewayTotal, 100);
  assert.equal(summary.localTotal, 0);
  assert.equal(summary.divergenceRatio, null);
  assert.equal(captured.length, 1);
  assert.match(
    JSON.stringify(captured[0]?.context),
    /zero_local_nonzero_gateway/
  );
});

test("skips divergence math when both Gateway and local cost are zero", async () => {
  const { runAiSpendDivergenceCheck } = await loadSpendModule();
  const { client } = createSpendSupabase(0);
  const captured: unknown[] = [];

  const summary = await runAiSpendDivergenceCheck({
    supabase: client as never,
    now: () => new Date("2026-05-16T12:00:00.000Z"),
    sentry: {
      captureMessage: (message, context) => {
        captured.push({ message, context });
        return "event-id";
      },
    },
    gateway: {
      getSpendReport: async () => ({
        results: [{ day: "2026-05-15", totalCost: 0 }],
      }),
    },
  });

  assert.equal(summary.skipped, true);
  assert.equal(summary.gatewayTotal, 0);
  assert.equal(summary.localTotal, 0);
  assert.equal(summary.divergenceRatio, null);
  assert.equal(captured.length, 0);
});

test("uses Gateway as the denominator when local cost is higher", async () => {
  const { runAiSpendDivergenceCheck } = await loadSpendModule();
  const { client } = createSpendSupabase(106);
  const captured: Array<{ message: string; context: unknown }> = [];

  const summary = await runAiSpendDivergenceCheck({
    supabase: client as never,
    now: () => new Date("2026-05-16T12:00:00.000Z"),
    sentry: {
      captureMessage: (message, context) => {
        captured.push({ message, context });
        return "event-id";
      },
    },
    gateway: {
      getSpendReport: async () => ({
        results: [{ day: "2026-05-15", totalCost: 100 }],
      }),
    },
  });

  assert.equal(summary.divergent, true);
  assert.equal(summary.divergenceRatio, 0.06);
  assert.equal(captured.length, 1);
});

test("captures drift when local cost exists but Gateway reports zero", async () => {
  const { runAiSpendDivergenceCheck } = await loadSpendModule();
  const { client } = createSpendSupabase(10);
  const captured: Array<{ message: string; context: unknown }> = [];

  const summary = await runAiSpendDivergenceCheck({
    supabase: client as never,
    now: () => new Date("2026-05-16T12:00:00.000Z"),
    sentry: {
      captureMessage: (message, context) => {
        captured.push({ message, context });
        return "event-id";
      },
    },
    gateway: {
      getSpendReport: async () => ({
        results: [{ day: "2026-05-15", totalCost: 0 }],
      }),
    },
  });

  assert.equal(summary.divergent, true);
  assert.equal(summary.skipped, false);
  assert.equal(summary.divergenceRatio, null);
  assert.equal(captured.length, 1);
  assert.match(
    JSON.stringify(captured[0]?.context),
    /gateway_zero_local_nonzero/
  );
});

test("captures drift when local cost is negative", async () => {
  const { runAiSpendDivergenceCheck } = await loadSpendModule();
  const { client } = createSpendSupabase(-1);
  const captured: Array<{ message: string; context: unknown }> = [];

  const summary = await runAiSpendDivergenceCheck({
    supabase: client as never,
    now: () => new Date("2026-05-16T12:00:00.000Z"),
    sentry: {
      captureMessage: (message, context) => {
        captured.push({ message, context });
        return "event-id";
      },
    },
    gateway: {
      getSpendReport: async () => ({
        results: [{ day: "2026-05-15", totalCost: 100 }],
      }),
    },
  });

  assert.equal(summary.divergent, true);
  assert.equal(summary.skipped, false);
  assert.equal(summary.divergenceRatio, null);
  assert.equal(captured.length, 1);
  assert.match(JSON.stringify(captured[0]?.context), /local_negative/);
});

test("propagates local cost query failures for scheduled run visibility", async () => {
  const { runAiSpendDivergenceCheck } = await loadSpendModule();
  const { client } = createSpendSupabase(null, { error: "db down" });

  await assert.rejects(
    runAiSpendDivergenceCheck({
      supabase: client as never,
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      sentry: {
        captureMessage: () => "event-id",
      },
      gateway: {
        getSpendReport: async () => ({
          results: [{ day: "2026-05-15", totalCost: 100 }],
        }),
      },
    }),
    /db down/
  );
});

test("rejects non-numeric local cost totals instead of silently using zero", async () => {
  const { runAiSpendDivergenceCheck } = await loadSpendModule();
  const { client } = createSpendSupabase("NaN");

  await assert.rejects(
    runAiSpendDivergenceCheck({
      supabase: client as never,
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      sentry: {
        captureMessage: () => "event-id",
      },
      gateway: {
        getSpendReport: async () => ({
          results: [{ day: "2026-05-15", totalCost: 100 }],
        }),
      },
    }),
    /Invalid numeric ai_calls cost total/
  );
});

test("propagates Gateway spend report failures for scheduled run visibility", async () => {
  const { runAiSpendDivergenceCheck } = await loadSpendModule();
  const { client } = createSpendSupabase(100);

  await assert.rejects(
    runAiSpendDivergenceCheck({
      supabase: client as never,
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      sentry: {
        captureMessage: () => "event-id",
      },
      gateway: {
        getSpendReport: async () => {
          throw new Error("gateway unavailable");
        },
      },
    }),
    /gateway unavailable/
  );
});
