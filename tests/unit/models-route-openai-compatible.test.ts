import assert from "node:assert/strict";
import test from "node:test";
import {
  autoEnableOn,
  catalogRow,
  loadModelsRoute,
} from "./helpers/models-route-fixtures";

const ENDPOINT_ENV = {
  MOGPLEX_OPENAI_COMPATIBLE_BASE_URL: "https://litellm.example/v1",
  MOGPLEX_OPENAI_COMPATIBLE_MODELS: "llama3.1:8b=Llama 3.1 8B,qwen2.5-coder",
} as const;

async function withEndpointEnv(fn: () => Promise<void>) {
  const keys = Object.keys(ENDPOINT_ENV) as (keyof typeof ENDPOINT_ENV)[];
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  try {
    for (const key of keys) process.env[key] = ENDPOINT_ENV[key];
    await fn();
  } finally {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const noProviderAccess = async () => ({
  data: {
    hasGateway: false,
    hasOpenAi: false,
    hasAnthropic: false,
    hasOpenRouter: false,
  },
  error: null,
});

test("GET /api/models offers the operator's OpenAI-compatible models to a user with no provider keys", async () => {
  await withEndpointEnv(async () => {
    const { createModelsGetHandler } = await loadModelsRoute();
    const handler = createModelsGetHandler({
      getUserId: async () => "user-123",
      loadProfileModelSettings: autoEnableOn,
      listAvailableModels: async () => ({ data: [], error: null }),
      listAllModels: async () => ({
        data: [catalogRow({ id: "openai/gpt-5-mini", provider: "openai" })],
        error: null,
      }),
      // The user disabled one endpoint model in settings.
      listUserModelPreferences: async () => ({
        data: [
          { model_id: "openai-compatible/qwen2.5-coder", is_enabled: false },
        ],
        error: null,
      }),
      loadUserProviderAccess: noProviderAccess,
    });

    const response = await handler();
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      payload.models.map((model: { id: string; name: string }) => [
        model.id,
        model.name,
      ]),
      [["openai-compatible/llama3.1:8b", "Llama 3.1 8B"]]
    );
    assert.deepEqual(
      payload.catalog.map((model: { id: string }) => model.id),
      [
        "openai/gpt-5-mini",
        "openai-compatible/llama3.1:8b",
        "openai-compatible/qwen2.5-coder",
      ]
    );
    assert.equal(payload.default_model, "openai-compatible/llama3.1:8b");
  });
});

test("GET /api/models lists the OpenAI-compatible models in the signed-out catalog", async () => {
  await withEndpointEnv(async () => {
    const { createModelsGetHandler } = await loadModelsRoute();
    const handler = createModelsGetHandler({
      getUserId: async () => undefined,
      listAvailableModels: async () => ({ data: [], error: null }),
    });

    const response = await handler();
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      payload.catalog.map((model: { id: string }) => model.id),
      ["openai-compatible/llama3.1:8b", "openai-compatible/qwen2.5-coder"]
    );
  });
});
