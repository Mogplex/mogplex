import assert from "node:assert/strict";
import test from "node:test";

async function loadModelsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/models/route");
}

const autoEnableOn = async () => ({
  data: { auto_enable_new_models: true, models_seen_at: null },
  error: null,
});

const allProviderAccess = async () => ({
  data: {
    hasGateway: true,
    hasOpenAi: true,
    hasAnthropic: true,
    hasOpenRouter: true,
  },
  error: null,
});

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
  // catalog — not an empty picker.
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
  // has not curated a positive selection — they expect the web UI's
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
  // gpt-5-mini is explicitly disabled → excluded.
  // sonnet-4.6 has no row → enabled-by-default → included.
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
  // sonnet-4.6 default-enabled — last one stays visible.
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
