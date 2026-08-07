import assert from "node:assert/strict";
import test from "node:test";

import { loadSyncModelsRoute } from "./helpers/sync-models-route-fixtures";

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
