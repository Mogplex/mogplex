import assert from "node:assert/strict";
import test from "node:test";
import {
  loadModelsRoute,
  autoEnableOn,
  allProviderAccess,
} from "./helpers/models-route-cli-format-fixtures";

test("GET /api/models?format=cli returns user-enabled and default-enabled models for authed users", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        {
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
          context_length: 400_000,
          pricing_input: 0.00000015,
          pricing_output: 0.0000006,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
        {
          id: "anthropic/claude-opus-4.1",
          provider: "anthropic",
          name: "Claude Opus 4.1",
          context_length: 200_000,
          pricing_input: 0.000015,
          pricing_output: 0.000075,
          capabilities: ["reasoning"],
          is_available: true,
          is_hidden: false,
        },
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({
      data: [{ model_id: "openai/gpt-5-mini", is_enabled: true }],
      error: null,
    }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler(
    new Request("http://localhost/api/models?format=cli")
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as Array<{ slug: string }>;
  assert.deepEqual(
    payload.map((m) => m.slug),
    ["openai/gpt-5-mini", "anthropic/claude-opus-4.1"]
  );
});

test("GET /api/models?format=cli includes default-enabled models alongside explicit enables", async () => {
  // CLI picker mirrors the web UI: a model with no preference row is
  // default-enabled when is_available. Partial curation (one explicit enable)
  // must not hide the rest of the default-enabled catalog.
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        {
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
          context_length: 400_000,
          pricing_input: 0.00000015,
          pricing_output: 0.0000006,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
        {
          id: "anthropic/claude-sonnet-4.6",
          provider: "anthropic",
          name: "Claude Sonnet 4.6",
          context_length: 1_000_000,
          pricing_input: 0.000003,
          pricing_output: 0.000015,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({
      data: [{ model_id: "openai/gpt-5-mini", is_enabled: true }],
      error: null,
    }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler(
    new Request("http://localhost/api/models?format=cli")
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as Array<{ slug: string }>;
  assert.deepEqual(payload.map((m) => m.slug).sort(), [
    "anthropic/claude-sonnet-4.6",
    "openai/gpt-5-mini",
  ]);
});

test("GET /api/models?format=cli falls back to default-enabled set when user has no preferences", async () => {
  // Regression guard: users who have never customized their model list (no
  // rows in user_model_preferences) should still see the default-enabled
  // catalog -- not an empty picker.
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        {
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
          context_length: 400_000,
          pricing_input: 0.00000015,
          pricing_output: 0.0000006,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler(
    new Request("http://localhost/api/models?format=cli")
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as Array<{ slug: string }>;
  assert.deepEqual(
    payload.map((m) => m.slug),
    ["openai/gpt-5-mini"]
  );
});

test("GET /api/models?format=cli falls back to default-enabled when preferences contain only explicit disables", async () => {
  // A user who has only ever disabled models (creating is_enabled:false rows)
  // has not curated a positive selection -- they expect the web UI's
  // default-enabled behavior to carry over to the CLI. Only the explicitly
  // disabled models should be excluded.
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        {
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
          context_length: 400_000,
          pricing_input: 0.00000015,
          pricing_output: 0.0000006,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
        {
          id: "anthropic/claude-sonnet-4.6",
          provider: "anthropic",
          name: "Claude Sonnet 4.6",
          context_length: 1_000_000,
          pricing_input: 0.000003,
          pricing_output: 0.000015,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({
      data: [{ model_id: "openai/gpt-5-mini", is_enabled: false }],
      error: null,
    }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler(
    new Request("http://localhost/api/models?format=cli")
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as Array<{ slug: string }>;
  // gpt-5-mini is explicitly disabled -> excluded.
  // sonnet-4.6 has no row -> enabled-by-default -> included.
  assert.deepEqual(
    payload.map((m) => m.slug),
    ["anthropic/claude-sonnet-4.6"]
  );
});

test("GET /api/models?format=cli excludes explicit disables while keeping default-enabled models", async () => {
  // Curated enables do not flip the picker into strict mode. Every is_available
  // model is included unless the user explicitly disabled it, so default-on
  // models keep showing even when the user has curated some enables.
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        {
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
          context_length: 400_000,
          pricing_input: 0.00000015,
          pricing_output: 0.0000006,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
        {
          id: "openai/gpt-5-pro",
          provider: "openai",
          name: "GPT-5 pro",
          context_length: 400_000,
          pricing_input: 0.000003,
          pricing_output: 0.000012,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
        {
          id: "anthropic/claude-sonnet-4.6",
          provider: "anthropic",
          name: "Claude Sonnet 4.6",
          context_length: 1_000_000,
          pricing_input: 0.000003,
          pricing_output: 0.000015,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({
      data: [
        { model_id: "openai/gpt-5-mini", is_enabled: true },
        { model_id: "openai/gpt-5-pro", is_enabled: false },
      ],
      error: null,
    }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler(
    new Request("http://localhost/api/models?format=cli")
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as Array<{ slug: string }>;
  // gpt-5-mini is explicitly enabled, gpt-5-pro explicitly disabled,
  // sonnet-4.6 default-enabled -- last one stays visible.
  assert.deepEqual(payload.map((m) => m.slug).sort(), [
    "anthropic/claude-sonnet-4.6",
    "openai/gpt-5-mini",
  ]);
});

test("GET /api/models?format=cli excludes curated enables for unavailable models", async () => {
  // A user with an explicit is_enabled:true row for a model that has since
  // been marked is_available:false must not see that model in the CLI picker.
  // The filter requires is_available regardless of the explicit preference.
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        {
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
          context_length: 400_000,
          pricing_input: 0.00000015,
          pricing_output: 0.0000006,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
        {
          id: "legacy/deprecated-model",
          provider: "legacy",
          name: "Deprecated",
          context_length: 100_000,
          pricing_input: 0.000001,
          pricing_output: 0.000001,
          capabilities: ["tool-use"],
          is_available: false,
          is_hidden: false,
        },
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({
      data: [
        { model_id: "openai/gpt-5-mini", is_enabled: true },
        { model_id: "legacy/deprecated-model", is_enabled: true },
      ],
      error: null,
    }),
    loadUserProviderAccess: allProviderAccess,
  });

  const response = await handler(
    new Request("http://localhost/api/models?format=cli")
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as Array<{ slug: string }>;
  assert.deepEqual(
    payload.map((m) => m.slug),
    ["openai/gpt-5-mini"]
  );
});
