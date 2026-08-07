import assert from "node:assert/strict";
import test from "node:test";

import {
  findBatchRow,
  loadSyncModelsRoute,
} from "./helpers/sync-models-route-fixtures";

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
