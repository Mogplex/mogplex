import assert from "node:assert/strict";
import test from "node:test";
import {
  loadModelsRoute,
  catalogRow,
  autoEnableOn,
  allProviderAccess,
} from "./helpers/models-route-fixtures";

test("GET /api/models hides DB-hidden catalog models for anonymous users", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => undefined,
    listAvailableModels: async () => ({
      data: [
        catalogRow({
          id: "minimax/minimax-m2.5",
          provider: "minimax",
          name: "MiniMax M2.5",
          pricing_input: 0.0000025,
          pricing_output: 0.00001,
        }),
        catalogRow({
          id: "legacy/hidden-model",
          provider: "legacy",
          name: "Hidden Legacy",
          is_hidden: true,
        }),
      ],
      error: null,
    }),
    listAllModels: async () => ({ data: [], error: null }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    models: [
      {
        id: "minimax/minimax-m2.5",
        provider: "minimax",
        name: "MiniMax M2.5",
        context_length: 200_000,
        pricing_input: 0.0000025,
        pricing_output: 0.00001,
        capabilities: ["tool-use"],
        is_available: true,
        is_hidden: false,
      },
    ],
    catalog: [
      {
        id: "minimax/minimax-m2.5",
        provider: "minimax",
        name: "MiniMax M2.5",
        context_length: 200_000,
        pricing_input: 0.0000025,
        pricing_output: 0.00001,
        capabilities: ["tool-use"],
        is_available: true,
        is_hidden: false,
      },
    ],
  });
});

test("GET /api/models keeps DB-hidden rows in authed catalog but not enabled models", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({
          id: "legacy/hidden-model",
          provider: "legacy",
          name: "Hidden Legacy",
          pricing_input: 0.000015,
          pricing_output: 0.000075,
          capabilities: ["reasoning"],
          is_hidden: true,
        }),
        catalogRow({
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
          context_length: 400_000,
          pricing_input: 0.00000015,
          pricing_output: 0.0000006,
        }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({
      data: [
        { model_id: "legacy/hidden-model", is_enabled: true },
        { model_id: "openai/gpt-5-mini", is_enabled: true },
      ],
      error: null,
    }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler();
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    payload.models.map((model: { id: string }) => model.id),
    ["openai/gpt-5-mini"]
  );
  assert.deepEqual(
    payload.catalog.map((model: { id: string }) => model.id),
    ["legacy/hidden-model", "openai/gpt-5-mini"]
  );
  assert.equal(payload.catalog[0]?.is_enabled, true);
  assert.equal(payload.catalog[0]?.is_hidden, true);
  assert.equal(payload.catalog[1]?.is_enabled, true);
  assert.equal(payload.catalog[1]?.is_hidden, false);
});

test("GET /api/models returns the stored default model when it is usable in this scope", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: async () => ({
      data: {
        auto_enable_new_models: true,
        models_seen_at: null,
        default_model: "sakana/fugu-ultra",
      },
      error: null,
    }),
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({ id: "minimax/minimax-m2.7", provider: "minimax" }),
        catalogRow({ id: "sakana/fugu-ultra", provider: "sakana" }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler();
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.default_model, "sakana/fugu-ultra");
});

test("GET /api/models falls back to a selectable default when the stored default is disabled", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: async () => ({
      data: {
        auto_enable_new_models: true,
        models_seen_at: null,
        default_model: "sakana/fugu-ultra",
      },
      error: null,
    }),
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({ id: "minimax/minimax-m2.7", provider: "minimax" }),
        catalogRow({ id: "sakana/fugu-ultra", provider: "sakana" }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({
      data: [{ model_id: "sakana/fugu-ultra", is_enabled: false }],
      error: null,
    }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler();
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.default_model, "minimax/minimax-m2.7");
});

test("GET /api/models treats missing preferences as enabled for available models", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({
          id: "minimax/minimax-m2.7",
          provider: "minimax",
          name: "MiniMax M2.7",
          context_length: 256_000,
          pricing_input: 0.0000025,
          pricing_output: 0.00001,
        }),
        catalogRow({
          id: "openai/gpt-5-pro-preview",
          provider: "openai",
          name: "GPT 5 Pro Preview",
          context_length: 400_000,
          pricing_input: 0.000021,
          pricing_output: 0.000168,
        }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({
      data: [],
      error: null,
    }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler();
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    payload.models.map((model: { id: string }) => model.id),
    ["minimax/minimax-m2.7", "openai/gpt-5-pro-preview"]
  );
  assert.equal(payload.catalog[0]?.is_enabled, true);
  assert.equal(payload.catalog[1]?.is_enabled, true);
});

test("GET /api/models withholds a new model when auto-enable is off", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: async () => ({
      data: {
        auto_enable_new_models: false,
        models_seen_at: "2026-06-01T00:00:00.000Z",
      },
      error: null,
    }),
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({
          id: "anthropic/old",
          created_at: "2026-05-01T00:00:00.000Z",
        }),
        catalogRow({
          id: "anthropic/new",
          created_at: "2026-06-15T00:00:00.000Z",
        }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler();
  const payload = await response.json();

  assert.equal(response.status, 200);
  // The new model is still listed in the full catalog but resolved disabled,
  // and is excluded from the invocable `models` set.
  const newRow = payload.catalog.find(
    (m: { id: string }) => m.id === "anthropic/new"
  );
  const oldRow = payload.catalog.find(
    (m: { id: string }) => m.id === "anthropic/old"
  );
  assert.equal(newRow?.is_enabled, false);
  assert.equal(oldRow?.is_enabled, true);
  assert.deepEqual(
    payload.models.map((m: { id: string }) => m.id),
    ["anthropic/old"]
  );
});

test("GET /api/models returns 500 when the profile settings load fails", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: async () => ({
      data: null,
      error: { message: "profile read failed" },
    }),
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({ data: [], error: null }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler();
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, "profile read failed");
});

test("GET /api/models?format=cli withholds a new model when auto-enable is off", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: async () => ({
      data: {
        auto_enable_new_models: false,
        models_seen_at: "2026-06-01T00:00:00.000Z",
      },
      error: null,
    }),
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({
          id: "anthropic/old",
          created_at: "2026-05-01T00:00:00.000Z",
        }),
        catalogRow({
          id: "anthropic/new",
          created_at: "2026-06-15T00:00:00.000Z",
        }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler(
    new Request("http://localhost/api/models?format=cli")
  );
  const payload = (await response.json()) as Array<{ slug: string }>;

  assert.equal(response.status, 200);
  assert.deepEqual(
    payload.map((m) => m.slug),
    ["anthropic/old"]
  );
});
