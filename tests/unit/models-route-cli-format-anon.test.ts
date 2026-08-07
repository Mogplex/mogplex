import assert from "node:assert/strict";
import test from "node:test";
import { loadModelsRoute } from "./helpers/models-route-cli-format-fixtures";

test("GET /api/models?format=cli returns CLI ModelInfo[] for anonymous users", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => undefined,
    listAvailableModels: async () => ({
      data: [
        {
          id: "anthropic/claude-sonnet-4.6",
          provider: "anthropic",
          name: "Claude Sonnet 4.6",
          context_length: 1_000_000,
          pricing_input: 0.000003,
          pricing_output: 0.000015,
          capabilities: ["reasoning", "tool-use"],
          is_available: true,
          is_hidden: false,
        },
        {
          id: "openai/gpt-5.2-pro",
          provider: "openai",
          name: "GPT 5.2 Pro",
          context_length: 400_000,
          pricing_input: 0.000021,
          pricing_output: 0.000168,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
      ],
      error: null,
    }),
    listAllModels: async () => ({ data: [], error: null }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
  });

  const response = await handler(
    new Request("http://localhost/api/models?format=cli")
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as Array<Record<string, unknown>>;
  assert.deepEqual(
    payload.map((model) => model.slug),
    ["anthropic/claude-sonnet-4.6", "openai/gpt-5.2-pro"]
  );
  assert.deepEqual(payload[0], {
    slug: "anthropic/claude-sonnet-4.6",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.6",
    inputModalities: ["text"],
    caps: {
      streaming: true,
      toolUse: true,
      reasoningEffort: true,
      parallelToolCalls: true,
    },
    contextWindow: 1_000_000,
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
      currency: "USD",
    },
  });
});

test("GET /api/models without format preserves legacy envelope", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => undefined,
    listAvailableModels: async () => ({
      data: [
        {
          id: "minimax/minimax-m2.7",
          provider: "minimax",
          name: "MiniMax M2.7",
          context_length: 200_000,
          pricing_input: 0.0000025,
          pricing_output: 0.00001,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
      ],
      error: null,
    }),
    listAllModels: async () => ({ data: [], error: null }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
  });

  const response = await handler();
  const payload = (await response.json()) as {
    models: unknown[];
    catalog: unknown[];
  };

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.models));
  assert.ok(Array.isArray(payload.catalog));
});

test("GET /api/models?format=cli omits pricing when catalog values are null", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => undefined,
    listAvailableModels: async () => ({
      data: [
        {
          id: "custom/private-model",
          provider: "custom",
          name: "Private",
          context_length: null,
          pricing_input: null,
          pricing_output: null,
          capabilities: [],
          is_available: true,
          is_hidden: false,
        },
      ],
      error: null,
    }),
    listAllModels: async () => ({ data: [], error: null }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
  });

  const response = await handler(
    new Request("http://localhost/api/models?format=cli")
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as Array<Record<string, unknown>>;
  assert.equal(payload.length, 1);
  const entry = payload[0];
  assert.equal(entry.slug, "custom/private-model");
  assert.equal("pricing" in entry, false);
  assert.equal("contextWindow" in entry, false);
  assert.deepEqual(entry.inputModalities, ["text"]);
  assert.deepEqual(entry.caps, {
    streaming: true,
    toolUse: false,
    reasoningEffort: false,
    parallelToolCalls: false,
  });
});

test("GET /api/models?format=cli surfaces image modality when catalog tags include vision", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => undefined,
    listAvailableModels: async () => ({
      data: [
        {
          id: "openai/gpt-5-vision",
          provider: "openai",
          name: "GPT-5 Vision",
          context_length: 400_000,
          pricing_input: 0.000001,
          pricing_output: 0.000004,
          capabilities: ["tool-use", "vision"],
          is_available: true,
          is_hidden: false,
        },
      ],
      error: null,
    }),
    listAllModels: async () => ({ data: [], error: null }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
  });

  const response = await handler(
    new Request("http://localhost/api/models?format=cli")
  );

  assert.equal(response.status, 200);
  const [entry] = (await response.json()) as Array<{
    inputModalities: string[];
  }>;
  assert.deepEqual(entry.inputModalities, ["text", "image"]);
});
