import assert from "node:assert/strict";
import test from "node:test";

async function loadSyncModelsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const route = await import("../../app/api/cron/sync-models/route");
  return {
    ...route,
    createSyncModelsGetHandler(
      overrides: Parameters<typeof route.createSyncModelsGetHandler>[0] = {}
    ) {
      return route.createSyncModelsGetHandler({
        syncProviderIcons: async () => ({
          attempted: 0,
          skipped: 0,
          upserted: 0,
          failedProviders: [],
        }),
        scheduleAfterResponse: (work) => {
          void work();
        },
        ...overrides,
      });
    },
  };
}

function findBatchRow(
  batches: Array<Array<Record<string, unknown>>>,
  id: string
) {
  const row = batches[0]?.find((entry) => entry.id === id);
  assert.ok(row, `expected ${id} to be upserted`);
  return row;
}

test("GET /api/cron/sync-models filters to language models and persists recommendation metadata", async () => {
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const batches: Array<Array<Record<string, unknown>>> = [];
  const unavailableCalls: string[][] = [];
  const providerIconCalls: string[][] = [];
  const deferred: Array<() => void | Promise<void>> = [];

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    scheduleAfterResponse: (work) => {
      deferred.push(work);
    },
    syncProviderIcons: async (providers) => {
      providerIconCalls.push([...providers]);
      return {
        attempted: providers.length,
        skipped: 0,
        upserted: providers.length,
        failedProviders: [],
      };
    },
    fetchGatewayModels: async () => [
      {
        id: "minimax/minimax-m2.7",
        name: "MiniMax M2.7",
        owned_by: "minimax",
        type: "language",
        context_window: 204_800,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.0000003", output: "0.0000012" },
      },
      {
        id: "anthropic/claude-sonnet-4.6",
        name: "Claude Sonnet 4.6",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000003", output: "0.000015" },
      },
      {
        id: "openai/gpt-oss-120b",
        name: "gpt-oss-120b",
        owned_by: "openai",
        type: "language",
        context_window: 128_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.00000015", output: "0.0000006" },
      },
      {
        id: "deepseek/deepseek-v3.2",
        name: "DeepSeek V3.2",
        owned_by: "deepseek",
        type: "language",
        context_window: 128_000,
        tags: ["tool-use"],
        pricing: { input: "0.00000028", output: "0.00000042" },
      },
      {
        id: "google/gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        owned_by: "google",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000002", output: "0.000012" },
      },
      {
        id: "google/imagen-4",
        name: "Imagen 4",
        owned_by: "google",
        type: "image",
      },
    ],
    listExistingModelIds: async () => ({
      data: [
        "minimax/minimax-m2.7",
        "anthropic/claude-sonnet-4.6",
        "openai/gpt-oss-120b",
        "deepseek/deepseek-v3.2",
        "google/gemini-2.5-pro",
        "stale/model",
      ],
      error: null,
    }),
    markModelsUnavailable: async (modelIds) => {
      unavailableCalls.push([...modelIds]);
      return { error: null };
    },
    upsertModelsBatch: async (batch) => {
      batches.push(batch as Array<Record<string, unknown>>);
      return { error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.synced, 5);
  assert.equal(payload.total_gateway, 5);
  assert.equal(payload.recommended, 4);
  assert.equal(payload.provider_icons_attempted, 0);
  assert.equal(payload.provider_icons_upserted, 0);
  assert.equal(payload.provider_icons_failed, 0);
  assert.equal(payload.provider_icons_status, "deferred");
  assert.equal(payload.provider_icons_scheduled, 5);
  assert.equal(batches.length, 1);
  assert.deepEqual(unavailableCalls, [["stale/model"]]);
  assert.deepEqual(providerIconCalls, []);
  assert.equal(deferred.length, 1);

  await deferred[0]();
  assert.deepEqual(providerIconCalls, [
    ["minimax", "anthropic", "openai", "deepseek", "google"],
  ]);
  assert.deepEqual(
    batches[0]?.map((row) => row.id),
    [
      "minimax/minimax-m2.7",
      "anthropic/claude-sonnet-4.6",
      "openai/gpt-oss-120b",
      "deepseek/deepseek-v3.2",
      "google/gemini-2.5-pro",
    ]
  );

  const minimax = batches[0]?.find((row) => row.id === "minimax/minimax-m2.7");
  const anthropic = batches[0]?.find(
    (row) => row.id === "anthropic/claude-sonnet-4.6"
  );
  const openModel = batches[0]?.find((row) => row.id === "openai/gpt-oss-120b");
  const deepseek = batches[0]?.find(
    (row) => row.id === "deepseek/deepseek-v3.2"
  );
  const google = batches[0]?.find((row) => row.id === "google/gemini-2.5-pro");

  assert.equal(minimax?.is_recommended, true);
  assert.equal("is_hidden" in (minimax ?? {}), false);
  assert.equal(minimax?.recommendation_bucket, "open");
  assert.equal(minimax?.recommendation_rank, 1);
  assert.equal(minimax?.recommendation_reason, "open_best_general");
  assert.equal(typeof minimax?.recommended_at, "string");

  assert.equal(anthropic?.recommendation_bucket, "frontier");
  assert.equal(anthropic?.recommendation_rank, 1);
  assert.equal(anthropic?.recommendation_reason, "frontier_latest_general");
  assert.equal(google?.recommendation_bucket, "frontier");
  assert.equal(google?.recommendation_rank, 2);
  assert.equal(openModel?.recommendation_bucket, "open");
  assert.equal(openModel?.recommendation_rank, 2);
  assert.equal(openModel?.recommendation_reason, "open_best_economy");
  assert.equal(deepseek?.is_recommended, false);
});

test("GET /api/cron/sync-models reports a provider icon scheduling failure", async () => {
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "openai/gpt-5",
        name: "GPT-5",
        owned_by: "openai",
        type: "language",
        tags: ["tool-use"],
      },
    ],
    scheduleAfterResponse: () => {
      throw new Error("scheduler unavailable");
    },
    listExistingModelIds: async () => ({
      data: ["openai/gpt-5"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    listModelSupersessions: async () => ({ data: [], error: null }),
    recordModelSupersessions: async () => ({ error: null }),
    deleteModelSupersessions: async () => ({ error: null }),
    listEffectiveModelSupersessions: async () => ({ data: [], error: null }),
    upgradeDeprecatedModelPins: async () => ({
      data: { flows: 0, agents: 0, profiles: 0 },
      error: null,
    }),
  });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const response = await handler(
      new Request("http://localhost/api/cron/sync-models")
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.provider_icons_status, "failed");
    assert.equal(payload.provider_icons_scheduled, 0);
  } finally {
    console.warn = originalWarn;
  }
});

test("GET /api/cron/sync-models preserves existing is_hidden values by omitting the column from upserts", async () => {
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const table = new Map<string, Record<string, unknown>>([
    [
      "legacy/hidden-model",
      {
        id: "legacy/hidden-model",
        provider: "legacy",
        name: "Hidden Legacy",
        is_available: false,
        is_hidden: true,
      },
    ],
  ]);

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "legacy/hidden-model",
        name: "Hidden Legacy",
        owned_by: "legacy",
        type: "language",
        context_window: 128_000,
        tags: ["tool-use"],
        pricing: { input: "0.000001", output: "0.000004" },
      },
    ],
    listExistingModelIds: async () => ({
      data: [...table.keys()],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async (batch) => {
      for (const row of batch as Array<Record<string, unknown>>) {
        assert.equal("is_hidden" in row, false);
        const existing = table.get(String(row.id)) ?? {};
        table.set(String(row.id), { ...existing, ...row });
      }
      return { error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  assert.equal(response.status, 200);
  assert.equal(table.get("legacy/hidden-model")?.is_available, true);
  assert.equal(table.get("legacy/hidden-model")?.is_hidden, true);
});

test("GET /api/cron/sync-models hides models missing from the Gateway catalog", async () => {
  const { buildStaleGatewayModelUpdate } = await loadSyncModelsRoute();

  assert.deepEqual(buildStaleGatewayModelUpdate(), {
    is_available: false,
    is_hidden: true,
    is_recommended: false,
    recommendation_bucket: null,
    recommendation_rank: null,
    recommendation_reason: null,
    recommended_at: null,
  });
});

test("GET /api/cron/sync-models returns 502 when gateway fetch fails", async () => {
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => {
      throw new Error("gateway down");
    },
    listExistingModelIds: async () => {
      throw new Error("listExistingModelIds should not be called");
    },
    markModelsUnavailable: async () => {
      throw new Error("markModelsUnavailable should not be called");
    },
    upsertModelsBatch: async () => {
      throw new Error("upsertModelsBatch should not be called");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "Failed to fetch AI Gateway models",
  });
});

test("GET /api/cron/sync-models does not clear the catalog before a failed upsert", async () => {
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  let staleMarkAttempts = 0;

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "minimax/minimax-m2.7",
        name: "MiniMax M2.7",
        owned_by: "minimax",
        type: "language",
        tags: ["tool-use"],
      },
    ],
    listExistingModelIds: async () => {
      throw new Error(
        "listExistingModelIds should not be called after a failed upsert"
      );
    },
    markModelsUnavailable: async () => {
      staleMarkAttempts += 1;
      return { error: null };
    },
    upsertModelsBatch: async () => ({ error: { message: "boom" } }),
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(staleMarkAttempts, 0);
  assert.equal(payload.error, "Upsert failed at batch 0: boom");
});

test("GET /api/cron/sync-models captures cache pricing from gateway catalog", async () => {
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const batches: Array<Array<Record<string, unknown>>> = [];

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "anthropic/claude-sonnet-4.6",
        name: "Claude Sonnet 4.6",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: {
          input: "0.000003",
          output: "0.000015",
          cache_input: "0.0000003",
          cache_creation: "0.00000375",
        },
      },
      {
        id: "anthropic/claude-haiku-4.5",
        name: "Claude Haiku 4.5",
        owned_by: "anthropic",
        type: "language",
        context_window: 200_000,
        tags: ["tool-use"],
        pricing: {
          input: "0.0000008",
          output: "0.000004",
          // Older catalog rows expose the shorthand keys.
          cache_read: "0.00000008",
          cache_write: "0.000001",
        },
      },
      {
        id: "sakana/fugu-ultra",
        name: "Fugu Ultra",
        owned_by: "sakana",
        type: "language",
        context_window: 1_000_000,
        tags: ["vision", "tool-use", "reasoning"],
        pricing: {
          input: "0.000005",
          output: "0.00003",
          input_cache_read: "0.0000005",
        },
      },
    ],
    listExistingModelIds: async () => ({ data: [], error: null }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async (batch) => {
      batches.push(batch as Array<Record<string, unknown>>);
      return { error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );
  assert.equal(response.status, 200);

  const sonnet = findBatchRow(batches, "anthropic/claude-sonnet-4.6");
  const haiku = findBatchRow(batches, "anthropic/claude-haiku-4.5");
  const fugu = findBatchRow(batches, "sakana/fugu-ultra");

  assert.equal(sonnet.pricing_input, 0.000003);
  assert.equal(sonnet.pricing_output, 0.000015);
  assert.equal(sonnet.pricing_cache_read, 0.0000003);
  assert.equal(sonnet.pricing_cache_write, 0.00000375);
  assert.equal(haiku.pricing_input, 0.0000008);
  assert.equal(haiku.pricing_output, 0.000004);
  assert.equal(haiku.pricing_cache_read, 0.00000008);
  assert.equal(haiku.pricing_cache_write, 0.000001);
  assert.equal(fugu.pricing_input, 0.000005);
  assert.equal(fugu.pricing_output, 0.00003);
  assert.equal(fugu.pricing_cache_read, 0.0000005);
  assert.equal(fugu.pricing_cache_write, null);
});

test("GET /api/cron/sync-models hides older same-priced Anthropic versions via the stale sweep", async () => {
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const batches: Array<Array<Record<string, unknown>>> = [];
  const unavailableCalls: string[][] = [];

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "anthropic/claude-opus-4.7",
        name: "Claude Opus 4.7",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000005", output: "0.000025" },
      },
      {
        id: "anthropic/claude-opus-4.8",
        name: "Claude Opus 4.8",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000005", output: "0.000025" },
      },
    ],
    listExistingModelIds: async () => ({
      data: ["anthropic/claude-opus-4.7", "anthropic/claude-opus-4.8"],
      error: null,
    }),
    markModelsUnavailable: async (modelIds) => {
      unavailableCalls.push([...modelIds]);
      return { error: null };
    },
    upsertModelsBatch: async (batch) => {
      batches.push(batch as Array<Record<string, unknown>>);
      return { error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    batches[0]?.map((row) => row.id),
    ["anthropic/claude-opus-4.8"]
  );
  assert.deepEqual(unavailableCalls, [["anthropic/claude-opus-4.7"]]);
});

test("GET /api/cron/sync-models records supersessions and upgrades pinned models", async () => {
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const recorded: Array<Array<Record<string, unknown>>> = [];
  let upgradeCalls = 0;

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "anthropic/claude-opus-4.8",
        name: "Claude Opus 4.8",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000005", output: "0.000025" },
      },
      {
        id: "anthropic/claude-opus-5",
        name: "Claude Opus 5",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000005", output: "0.000025" },
      },
    ],
    listExistingModelIds: async () => ({
      data: ["anthropic/claude-opus-4.8"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    // Opus 4.7 was already recorded as superseded by 4.8; now that 4.8 is
    // itself superseded, both rows must move to Opus 5 so the stored mapping
    // stays a single hop to a live model.
    listModelSupersessions: async () => ({
      data: [
        {
          deprecated_model_id: "anthropic/claude-opus-4.7",
          successor_model_id: "anthropic/claude-opus-4.8",
        },
      ],
      error: null,
    }),
    recordModelSupersessions: async (rows) => {
      recorded.push(rows as unknown as Array<Record<string, unknown>>);
      return { error: null };
    },
    upgradeDeprecatedModelPins: async () => {
      upgradeCalls += 1;
      return { data: { flows: 2, agents: 1, profiles: 0 }, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    recorded[0]
      ?.map((row) => ({
        deprecated: String(row.deprecated_model_id),
        successor: String(row.successor_model_id),
      }))
      .sort((left, right) => left.deprecated.localeCompare(right.deprecated)),
    [
      {
        deprecated: "anthropic/claude-opus-4.7",
        successor: "anthropic/claude-opus-5",
      },
      {
        deprecated: "anthropic/claude-opus-4.8",
        successor: "anthropic/claude-opus-5",
      },
    ]
  );
  assert.equal(upgradeCalls, 1);

  const body = (await response.json()) as {
    supersessions_recorded: number;
    pins_upgraded: Record<string, number>;
  };
  assert.equal(body.supersessions_recorded, 2);
  assert.deepEqual(body.pins_upgraded, { flows: 2, agents: 1, profiles: 0 });
});

test("GET /api/cron/sync-models still succeeds when the pin upgrade fails", async () => {
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "anthropic/claude-opus-5",
        name: "Claude Opus 5",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000005", output: "0.000025" },
      },
    ],
    listExistingModelIds: async () => ({ data: [], error: null }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    listModelSupersessions: async () => ({ data: [], error: null }),
    recordModelSupersessions: async () => ({ error: null }),
    upgradeDeprecatedModelPins: async () => ({
      data: null,
      error: { message: "deadlock detected" },
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  // The catalog sync itself succeeded; the reconcile retries next run rather
  // than failing the cron and leaving the catalog un-synced.
  assert.equal(response.status, 200);
  const body = (await response.json()) as { pins_upgraded: unknown };
  assert.equal(body.pins_upgraded, null);
});

test("GET /api/cron/sync-models drops models released more than 9 months ago or missing tool-use", async () => {
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const batches: Array<Array<Record<string, unknown>>> = [];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const oneMonthAgo = nowSeconds - 30 * 24 * 60 * 60;
  const tenMonthsAgo = nowSeconds - 10 * 30 * 24 * 60 * 60;

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "fresh/model",
        name: "Fresh",
        owned_by: "fresh",
        type: "language",
        tags: ["tool-use"],
        released: oneMonthAgo,
      },
      {
        id: "ancient/model",
        name: "Ancient",
        owned_by: "ancient",
        type: "language",
        tags: ["tool-use"],
        released: tenMonthsAgo,
      },
      {
        id: "no-tool/model",
        name: "No Tool",
        owned_by: "no-tool",
        type: "language",
        tags: ["reasoning"],
        released: oneMonthAgo,
      },
      {
        id: "no-date/model",
        name: "No Date",
        owned_by: "no-date",
        type: "language",
        tags: ["tool-use"],
      },
    ],
    listExistingModelIds: async () => ({ data: [], error: null }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async (batch) => {
      batches.push(batch as Array<Record<string, unknown>>);
      return { error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.total_gateway, 2);
  assert.deepEqual(
    batches[0]?.map((row) => row.id),
    ["fresh/model", "no-date/model"]
  );
});

test("GET /api/cron/sync-models retracts a supersession the policy no longer agrees with", async () => {
  // Opus 5's pricing diverges, so Opus 4.8 is retained again and is no longer
  // superseded. The stored 4.8 -> 5 mapping must be deleted, otherwise it keeps
  // moving pins off a model that is on offer again. The deprecated-side filter
  // in model_supersessions_effective cannot do this on its own: the sync
  // deliberately omits is_hidden from its upsert so the stale sweep's hide is
  // durable, meaning a re-offered model never looks "on offer" to that view.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const deleted: string[][] = [];
  const recorded: Array<Array<Record<string, unknown>>> = [];

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "anthropic/claude-opus-4.8",
        name: "Claude Opus 4.8",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000005", output: "0.000025" },
      },
      {
        id: "anthropic/claude-opus-5",
        name: "Claude Opus 5",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        // Dearer than 4.8, so the same-price rule no longer applies.
        pricing: { input: "0.00001", output: "0.00005" },
      },
    ],
    listExistingModelIds: async () => ({
      data: ["anthropic/claude-opus-4.8", "anthropic/claude-opus-5"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    listModelSupersessions: async () => ({
      data: [
        {
          deprecated_model_id: "anthropic/claude-opus-4.8",
          successor_model_id: "anthropic/claude-opus-5",
        },
      ],
      error: null,
    }),
    recordModelSupersessions: async (rows) => {
      recorded.push(rows as unknown as Array<Record<string, unknown>>);
      return { error: null };
    },
    deleteModelSupersessions: async (ids) => {
      deleted.push([...ids]);
      return { error: null };
    },
    upgradeDeprecatedModelPins: async () => ({
      data: { flows: 0, agents: 0, profiles: 0 },
      error: null,
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(deleted, [["anthropic/claude-opus-4.8"]]);
  // Nothing re-recorded: the retracted mapping must not be written straight back.
  assert.deepEqual(recorded, []);
});

test("GET /api/cron/sync-models does not report a retraction as inert", async () => {
  // warnOnInertSupersessions lost its retractedIds parameter when it moved to
  // the post-write table, so the "deleted on purpose is not a surprise" rule
  // now lives only in how the caller builds that table. Pins it here: a row
  // this run retracted must not come back as an inert-supersession warning.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const handler = createSyncModelsGetHandler({
      requireMachineApiAuth: () => null,
      fetchGatewayModels: async () => [
        {
          id: "anthropic/claude-opus-4.8",
          name: "Claude Opus 4.8",
          owned_by: "anthropic",
          type: "language",
          context_window: 1_000_000,
          tags: ["reasoning", "tool-use"],
          pricing: { input: "0.000005", output: "0.000025" },
        },
        {
          id: "anthropic/claude-opus-5",
          name: "Claude Opus 5",
          owned_by: "anthropic",
          type: "language",
          context_window: 1_000_000,
          tags: ["reasoning", "tool-use"],
          // Diverged, so 4.8 is retained and its mapping is retracted.
          pricing: { input: "0.00001", output: "0.00005" },
        },
      ],
      listExistingModelIds: async () => ({
        data: ["anthropic/claude-opus-4.8", "anthropic/claude-opus-5"],
        error: null,
      }),
      markModelsUnavailable: async () => ({ error: null }),
      upsertModelsBatch: async () => ({ error: null }),
      listModelSupersessions: async () => ({
        data: [
          {
            deprecated_model_id: "anthropic/claude-opus-4.8",
            successor_model_id: "anthropic/claude-opus-5",
          },
        ],
        error: null,
      }),
      recordModelSupersessions: async () => ({ error: null }),
      deleteModelSupersessions: async () => ({ error: null }),
      // Nothing in effect, so any row still in the table would be called inert.
      listEffectiveModelSupersessions: async () => ({ data: [], error: null }),
      upgradeDeprecatedModelPins: async () => ({
        data: { flows: 0, agents: 0, profiles: 0 },
        error: null,
      }),
    });

    const response = await handler(
      new Request("http://localhost/api/cron/sync-models")
    );
    assert.equal(response.status, 200);
    const inertWarning = warnings.find(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("supersessions recorded but not in effect")
    );
    assert.equal(
      inertWarning,
      undefined,
      "a retracted supersession must not be reported as inert"
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("GET /api/cron/sync-models does not upgrade pins when retraction fails", async () => {
  // A surviving stale mapping would rewrite pins off a model the policy just
  // re-retained, and that rewrite does not heal on the next run — the pin has
  // already moved. So a failed retraction must skip the reconcile entirely.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  let upgradeCalls = 0;

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "anthropic/claude-opus-4.8",
        name: "Claude Opus 4.8",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000005", output: "0.000025" },
      },
    ],
    listExistingModelIds: async () => ({
      data: ["anthropic/claude-opus-4.8"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    listModelSupersessions: async () => ({
      data: [
        {
          deprecated_model_id: "anthropic/claude-opus-4.8",
          successor_model_id: "anthropic/claude-opus-5",
        },
      ],
      error: null,
    }),
    recordModelSupersessions: async () => ({ error: null }),
    deleteModelSupersessions: async () => ({
      error: { message: "deadlock detected" },
    }),
    upgradeDeprecatedModelPins: async () => {
      upgradeCalls += 1;
      return { data: { flows: 0, agents: 0, profiles: 0 }, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  // The catalog sync still succeeds; only the reconcile is deferred.
  assert.equal(response.status, 200);
  assert.equal(upgradeCalls, 0);
  const body = (await response.json()) as { pins_upgraded: unknown };
  assert.equal(body.pins_upgraded, null);
});

test("GET /api/cron/sync-models deletes a corrupted supersession cycle", async () => {
  // A cycle means the table needs two bad writes to reach, but if it ever does,
  // leaving it makes the affected pins stop upgrading permanently. The cron
  // repairs it so the policy can re-derive the mapping from the catalog.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  const deleted: string[][] = [];

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "anthropic/claude-opus-5",
        name: "Claude Opus 5",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000005", output: "0.000025" },
      },
    ],
    listExistingModelIds: async () => ({
      data: ["anthropic/claude-opus-5"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    listModelSupersessions: async () => ({
      data: [
        { deprecated_model_id: "model-a", successor_model_id: "model-b" },
        { deprecated_model_id: "model-b", successor_model_id: "model-a" },
      ],
      error: null,
    }),
    recordModelSupersessions: async () => ({ error: null }),
    deleteModelSupersessions: async (ids) => {
      deleted.push([...ids]);
      return { error: null };
    },
    upgradeDeprecatedModelPins: async () => ({
      data: { flows: 0, agents: 0, profiles: 0 },
      error: null,
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    deleted.map((ids) => [...ids].sort()),
    [["model-a", "model-b"]]
  );
  const body = (await response.json()) as { supersessions_purged: number };
  assert.equal(body.supersessions_purged, 2);
});

test("GET /api/cron/sync-models reports zero purged when the purge delete fails", async () => {
  // The count is rows actually removed. Reporting the attempted count would
  // claim a repair that did not happen, and the cycle is still in the table.
  // The reconcile deliberately continues: no edge of a cycle can be in effect
  // (each would need its model both on and off offer), so the pin rewrite that
  // follows cannot act on one.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  let upgradeCalls = 0;

  const handler = createSyncModelsGetHandler({
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [
      {
        id: "anthropic/claude-opus-5",
        name: "Claude Opus 5",
        owned_by: "anthropic",
        type: "language",
        context_window: 1_000_000,
        tags: ["reasoning", "tool-use"],
        pricing: { input: "0.000005", output: "0.000025" },
      },
    ],
    listExistingModelIds: async () => ({
      data: ["anthropic/claude-opus-5"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    listModelSupersessions: async () => ({
      data: [
        { deprecated_model_id: "model-a", successor_model_id: "model-b" },
        { deprecated_model_id: "model-b", successor_model_id: "model-a" },
      ],
      error: null,
    }),
    recordModelSupersessions: async () => ({ error: null }),
    deleteModelSupersessions: async () => ({
      error: { message: "delete failed" },
    }),
    listEffectiveModelSupersessions: async () => ({ data: [], error: null }),
    upgradeDeprecatedModelPins: async () => {
      upgradeCalls += 1;
      return { data: { flows: 0, agents: 0, profiles: 0 }, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/sync-models")
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    supersessions_purged: number;
    reconcile_status: string;
  };
  assert.equal(body.supersessions_purged, 0);
  // Not aborted: a failed purge deliberately continues (no edge of a cycle can
  // be in effect), so the run really did complete.
  assert.equal(body.reconcile_status, "ok");
  assert.equal(upgradeCalls, 1);
});

test("GET /api/cron/sync-models checks freshly written supersessions for inertness", async () => {
  // The check used to be passed the pre-write snapshot, so a row recorded by
  // this very run — the one most worth knowing about — was never checked.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();
  let checkedTable: string[] = [];
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const handler = createSyncModelsGetHandler({
      requireMachineApiAuth: () => null,
      // Opus 4.8 and Opus 5 at identical pricing: 4.8 is superseded, so this
      // run records 4.8 -> 5 for the first time.
      fetchGatewayModels: async () => [
        {
          id: "anthropic/claude-opus-4.8",
          name: "Claude Opus 4.8",
          owned_by: "anthropic",
          type: "language",
          context_window: 1_000_000,
          tags: ["reasoning", "tool-use"],
          pricing: { input: "0.000005", output: "0.000025" },
        },
        {
          id: "anthropic/claude-opus-5",
          name: "Claude Opus 5",
          owned_by: "anthropic",
          type: "language",
          context_window: 1_000_000,
          tags: ["reasoning", "tool-use"],
          pricing: { input: "0.000005", output: "0.000025" },
        },
      ],
      listExistingModelIds: async () => ({
        data: ["anthropic/claude-opus-4.8", "anthropic/claude-opus-5"],
        error: null,
      }),
      markModelsUnavailable: async () => ({ error: null }),
      upsertModelsBatch: async () => ({ error: null }),
      listModelSupersessions: async () => ({ data: [], error: null }),
      recordModelSupersessions: async () => ({ error: null }),
      deleteModelSupersessions: async () => ({ error: null }),
      // Nothing is in effect, so the row just written is inert.
      listEffectiveModelSupersessions: async () => {
        checkedTable = ["called"];
        return { data: [], error: null };
      },
      upgradeDeprecatedModelPins: async () => ({
        data: { flows: 0, agents: 0, profiles: 0 },
        error: null,
      }),
    });

    const response = await handler(
      new Request("http://localhost/api/cron/sync-models")
    );
    assert.equal(response.status, 200);
    // With the old pre-write snapshot (empty) the check returned early and this
    // dep was never reached.
    assert.deepEqual(checkedTable, ["called"]);
    const inertWarning = warnings.find(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("supersessions recorded but not in effect")
    );
    assert.ok(inertWarning, "expected an inert-supersession warning");
    assert.deepEqual(
      (inertWarning?.[1] as { deprecatedModelIds: string[] })
        .deprecatedModelIds,
      ["anthropic/claude-opus-4.8"]
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("GET /api/cron/sync-models marks an aborted reconcile distinctly from a clean no-op", async () => {
  // All-zeros with a null pins_upgraded is what a healthy run with nothing to
  // do returns too, so without a discriminator the JSON cannot tell "nothing
  // needed doing" from "we bailed on a database error" — the failure would live
  // only in the cron log.
  const { createSyncModelsGetHandler } = await loadSyncModelsRoute();

  const gatewayModel = {
    id: "anthropic/claude-opus-5",
    name: "Claude Opus 5",
    owned_by: "anthropic",
    type: "language" as const,
    context_window: 1_000_000,
    tags: ["reasoning", "tool-use"],
    pricing: { input: "0.000005", output: "0.000025" },
  };
  const baseDeps = {
    requireMachineApiAuth: () => null,
    fetchGatewayModels: async () => [gatewayModel],
    listExistingModelIds: async () => ({
      data: ["anthropic/claude-opus-5"],
      error: null,
    }),
    markModelsUnavailable: async () => ({ error: null }),
    upsertModelsBatch: async () => ({ error: null }),
    recordModelSupersessions: async () => ({ error: null }),
    deleteModelSupersessions: async () => ({ error: null }),
    listEffectiveModelSupersessions: async () => ({ data: [], error: null }),
    upgradeDeprecatedModelPins: async () => ({
      data: { flows: 0, agents: 0, profiles: 0 },
      error: null,
    }),
  };

  const healthy = await createSyncModelsGetHandler({
    ...baseDeps,
    listModelSupersessions: async () => ({ data: [], error: null }),
  })(new Request("http://localhost/api/cron/sync-models"));

  const aborted = await createSyncModelsGetHandler({
    ...baseDeps,
    listModelSupersessions: async () => ({
      data: null,
      error: { message: "connection reset" },
    }),
  })(new Request("http://localhost/api/cron/sync-models"));

  const healthyBody = (await healthy.json()) as Record<string, unknown>;
  const abortedBody = (await aborted.json()) as Record<string, unknown>;

  assert.equal(healthyBody.reconcile_status, "ok");
  assert.equal(abortedBody.reconcile_status, "aborted");
  // The counts really are identical — the status is the only thing separating
  // them, which is the point.
  assert.equal(healthyBody.supersessions_recorded, 0);
  assert.equal(abortedBody.supersessions_recorded, 0);
  assert.equal(abortedBody.supersessions_purged, 0);
  assert.equal(abortedBody.pins_upgraded, null);
});
