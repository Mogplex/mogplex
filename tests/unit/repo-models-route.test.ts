import assert from "node:assert/strict";
import test from "node:test";

async function loadRepoModelsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/repos/[id]/models/route");
}

const autoEnableOn = async () => ({
  data: { auto_enable_new_models: true, models_seen_at: null },
  error: null,
});

test("GET /api/repos/[id]/models hides DB-hidden catalog models", async () => {
  const { createRepoModelsGetHandler } = await loadRepoModelsRoute();

  const handler = createRepoModelsGetHandler({
    requireUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    getOwnedRepo: async <T = { id: string }>() => ({ id: "repo-123" }) as T,
    listAllModels: async () => ({
      data: [
        {
          id: "openai/gpt-5.2-pro",
          provider: "openai",
          name: "GPT 5.2",
          context_length: 400_000,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: true,
        },
        {
          id: "minimax/minimax-m2.5",
          provider: "minimax",
          name: "MiniMax M2.5",
          context_length: 200_000,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({
      data: [
        { model_id: "openai/gpt-5.2-pro", is_enabled: true },
        { model_id: "minimax/minimax-m2.5", is_enabled: true },
      ],
      error: null,
    }),
    listRepoModelOverrides: async () => ({
      data: [],
      error: null,
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/repos/repo-123/models") as never,
    {
      params: Promise.resolve({ id: "repo-123" }),
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    models: [
      {
        id: "minimax/minimax-m2.5",
        provider: "minimax",
        name: "MiniMax M2.5",
        context_length: 200_000,
        capabilities: ["tool-use"],
        is_available: true,
        is_hidden: false,
        is_enabled: true,
      },
    ],
    overrides: [],
  });
});

test("GET /api/repos/[id]/models treats missing preferences as enabled for available models", async () => {
  const { createRepoModelsGetHandler } = await loadRepoModelsRoute();

  const handler = createRepoModelsGetHandler({
    requireUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    getOwnedRepo: async <T = { id: string }>() => ({ id: "repo-123" }) as T,
    listAllModels: async () => ({
      data: [
        {
          id: "minimax/minimax-m2.7",
          provider: "minimax",
          name: "MiniMax M2.7",
          context_length: 256_000,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
        {
          id: "openai/gpt-5-pro-preview",
          provider: "openai",
          name: "GPT 5 Pro Preview",
          context_length: 400_000,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
        },
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({
      data: [],
      error: null,
    }),
    listRepoModelOverrides: async () => ({
      data: [],
      error: null,
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/repos/repo-123/models") as never,
    {
      params: Promise.resolve({ id: "repo-123" }),
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    models: [
      {
        id: "minimax/minimax-m2.7",
        provider: "minimax",
        name: "MiniMax M2.7",
        context_length: 256_000,
        capabilities: ["tool-use"],
        is_available: true,
        is_hidden: false,
        is_enabled: true,
      },
      {
        id: "openai/gpt-5-pro-preview",
        provider: "openai",
        name: "GPT 5 Pro Preview",
        context_length: 400_000,
        capabilities: ["tool-use"],
        is_available: true,
        is_hidden: false,
        is_enabled: true,
      },
    ],
    overrides: [],
  });
});

test("GET /api/repos/[id]/models withholds a new model when auto-enable is off", async () => {
  const { createRepoModelsGetHandler } = await loadRepoModelsRoute();

  const handler = createRepoModelsGetHandler({
    requireUserId: async () => "user-123",
    loadProfileModelSettings: async () => ({
      data: {
        auto_enable_new_models: false,
        models_seen_at: "2026-06-01T00:00:00.000Z",
      },
      error: null,
    }),
    getOwnedRepo: async <T = { id: string }>() => ({ id: "repo-123" }) as T,
    listAllModels: async () => ({
      data: [
        {
          id: "anthropic/old",
          provider: "anthropic",
          name: "Old",
          context_length: 200_000,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
          created_at: "2026-05-01T00:00:00.000Z",
        },
        {
          id: "anthropic/new",
          provider: "anthropic",
          name: "New",
          context_length: 200_000,
          capabilities: ["tool-use"],
          is_available: true,
          is_hidden: false,
          created_at: "2026-06-15T00:00:00.000Z",
        },
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    listRepoModelOverrides: async () => ({ data: [], error: null }),
  });

  const response = await handler(
    new Request("http://localhost/api/repos/repo-123/models") as never,
    { params: Promise.resolve({ id: "repo-123" }) }
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    payload.models.map((m: { id: string }) => m.id),
    ["anthropic/old"]
  );
});

test("GET /api/repos/[id]/models returns 500 when the profile settings load fails", async () => {
  const { createRepoModelsGetHandler } = await loadRepoModelsRoute();

  const handler = createRepoModelsGetHandler({
    requireUserId: async () => "user-123",
    loadProfileModelSettings: async () => ({
      data: null,
      error: { message: "profile read failed" },
    }),
    getOwnedRepo: async <T = { id: string }>() => ({ id: "repo-123" }) as T,
    listAllModels: async () => ({ data: [], error: null }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    listRepoModelOverrides: async () => ({ data: [], error: null }),
  });

  const response = await handler(
    new Request("http://localhost/api/repos/repo-123/models") as never,
    { params: Promise.resolve({ id: "repo-123" }) }
  );

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, "profile read failed");
});

test("POST /api/repos/[id]/models reports a failed unexclude write", async () => {
  const { createRepoModelsPostHandler } = await loadRepoModelsRoute();
  const handler = createRepoModelsPostHandler({
    requireUserId: async () => "user-123",
    getOwnedRepo: async <T = { id: string }>() => ({ id: "repo-123" }) as T,
    upsertRepoModelOverride: async () => ({ error: null }),
    deleteRepoModelOverride: async () => ({
      error: { message: "delete failed" },
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/repos/repo-123/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_id: "openai/gpt-5.6-sol", excluded: false }),
    }) as never,
    { params: Promise.resolve({ id: "repo-123" }) }
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "delete failed" });
});
