import assert from "node:assert/strict";
import test from "node:test";

async function loadModelsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/models/route");
}

type CatalogFixture = {
  id: string;
  provider: string;
  name: string;
  context_length: number | null;
  pricing_input: number | null;
  pricing_output: number | null;
  capabilities: string[];
  is_available: boolean;
  is_hidden: boolean;
  created_at: string | null;
};

function catalogRow(
  overrides: Partial<CatalogFixture> & Pick<CatalogFixture, "id">
): CatalogFixture {
  return {
    provider: "test",
    name: overrides.id,
    context_length: 200_000,
    pricing_input: 0.000001,
    pricing_output: 0.000004,
    capabilities: ["tool-use"],
    is_available: true,
    is_hidden: false,
    created_at: "2000-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Auto-enable on => the new-model off-switch policy never withholds, so these
// tests exercise the legacy "missing preference = enabled" semantics.
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

test("GET /api/models filters out unreachable providers from the dropdown payload", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
        }),
        catalogRow({
          id: "moonshotai/kimi-k2.6",
          provider: "moonshotai",
          name: "Kimi K2.6",
        }),
        catalogRow({
          id: "openrouter/deepseek/deepseek-v4-pro",
          provider: "openrouter",
          name: "DeepSeek v4 Pro (OpenRouter)",
        }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    // User has gateway access but no OpenRouter key.
    loadUserProviderAccess: async () => ({
      data: {
        hasGateway: true,
        hasOpenAi: false,
        hasAnthropic: false,
        hasOpenRouter: false,
      },
      error: null,
    }),
  });

  const response = await handler();
  const payload = await response.json();

  assert.equal(response.status, 200);
  // Dropdown only sees reachable models — OpenRouter row is hidden.
  assert.deepEqual(
    [...payload.models].map((model: { id: string }) => model.id).sort(),
    ["moonshotai/kimi-k2.6", "openai/gpt-5-mini"]
  );
  // Settings catalog still shows every model so the user can enable
  // OpenRouter integration later.
  assert.deepEqual(
    [...payload.catalog].map((model: { id: string }) => model.id).sort(),
    [
      "moonshotai/kimi-k2.6",
      "openai/gpt-5-mini",
      "openrouter/deepseek/deepseek-v4-pro",
    ]
  );
});

test("GET /api/models applies active team capabilities and model allowlist", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();
  let providerAccessTeamId: string | null = null;
  let capabilitiesTeamId: string | null | undefined;
  let allowlistTeamId = "";

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
        }),
        catalogRow({
          id: "anthropic/claude-sonnet-5",
          provider: "anthropic",
          name: "Claude Sonnet 5",
        }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    loadUserProviderAccess: async (_userId, teamId) => {
      providerAccessTeamId = teamId;
      return allProviderAccess();
    },
    resolveMemberCapabilities: async (_userId, teamId) => {
      capabilitiesTeamId = teamId;
      return new Set(["models.openai.*"]);
    },
    loadTeamAllowlistState: async (teamId) => {
      allowlistTeamId = teamId;
      return {
        status: "restricted",
        models: ["openai/gpt-5-mini", "anthropic/claude-sonnet-5"],
      };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/models", {
      headers: { "x-mogplex-team-id": "00000000-0000-4000-8000-000000000123" },
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(providerAccessTeamId, "00000000-0000-4000-8000-000000000123");
  assert.equal(capabilitiesTeamId, "00000000-0000-4000-8000-000000000123");
  assert.equal(allowlistTeamId, "00000000-0000-4000-8000-000000000123");
  assert.deepEqual(
    payload.models.map((model: { id: string }) => model.id),
    ["openai/gpt-5-mini"]
  );
  assert.deepEqual(
    payload.catalog.map((model: { id: string }) => model.id),
    ["openai/gpt-5-mini", "anthropic/claude-sonnet-5"]
  );
});

test("GET /api/models returns 500 when the team allowlist cannot be read (does not offer forbidden models)", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
        }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    loadUserProviderAccess: allProviderAccess,
    resolveMemberCapabilities: async () => new Set(["models.*"]),
    loadTeamAllowlistState: async () => ({
      status: "unknown",
      reason: "read failed",
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/models", {
      headers: { "x-mogplex-team-id": "00000000-0000-4000-8000-000000000123" },
    })
  );

  // Not a 200 with an unfiltered picker: offering models the team forbids
  // surfaces a transient read error as a permissions error at invocation time.
  // 503 rather than 500 so this agrees with the other two surfaces that map
  // the same condition — the failure is transient, and a 500 reads as a bug.
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "5");

  const body = await response.json();
  // A machine-readable marker so a client can eventually distinguish this from
  // a generic failure (#769). No catalog: fetchJsonObject discards non-ok
  // bodies, so shipping one would be pure cost on a degraded path.
  assert.equal(body.allowlistUnavailable, true);
  assert.equal("catalog" in body, false);
});

test("GET /api/models returns 500 when provider access lookup fails (does not silently empty the picker)", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
        }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    loadUserProviderAccess: async () => ({
      data: null,
      error: { message: "vault unavailable" },
    }),
  });

  const response = await handler();
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, "vault unavailable");
});

test("PATCH /api/models rejects global catalog mutation fields", async () => {
  const { createModelsPatchHandler } = await loadModelsRoute();
  let upsertCalls = 0;

  const handler = createModelsPatchHandler({
    requireUserId: async () => "user-123",
    upsertUserModelPreference: async () => {
      upsertCalls += 1;
      return { error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/models", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: "openai-gpt-5",
        is_enabled: true,
        provider: "openai",
        is_hidden: true,
        name: "gpt-5",
      }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error:
      "Global model catalog updates are not allowed from /api/models. Use the sync-models cron instead.",
  });
  assert.equal(upsertCalls, 0);
});

test("PATCH /api/models only updates user model preferences", async () => {
  const { createModelsPatchHandler } = await loadModelsRoute();
  const calls: Array<{ userId: string; modelId: string; isEnabled: boolean }> =
    [];

  const handler = createModelsPatchHandler({
    requireUserId: async () => "user-123",
    upsertUserModelPreference: async (input) => {
      calls.push(input);
      return { error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/models", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: "openai-gpt-5",
        is_enabled: false,
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(calls, [
    {
      userId: "user-123",
      modelId: "openai-gpt-5",
      isEnabled: false,
    },
  ]);
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
