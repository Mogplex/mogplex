import assert from "node:assert/strict";
import test from "node:test";

async function loadSettingsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/settings/route");
}

test("GET /api/settings returns the resolved usable default model", async () => {
  const { createSettingsGetHandler } = await loadSettingsRoute();

  const handler = createSettingsGetHandler({
    requireUserId: async () => "user-123",
    loadProfile: async () => ({
      data: {
        default_model: "openai/gpt-5.4",
        theme: "dark",
      },
      error: null,
    }),
    resolveUserDefaultModelId: async () => "minimax/minimax-m2.7",
  });

  const response = await handler();
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.default_model, "minimax/minimax-m2.7");
  assert.equal(payload.theme, "dark");
});

test("PATCH /api/settings rejects disabled default models", async () => {
  const { createSettingsPatchHandler } = await loadSettingsRoute();
  let updateCalls = 0;

  const handler = createSettingsPatchHandler({
    requireUserId: async () => "user-123",
    canUserSetDefaultModel: async () => false,
    updateProfile: async () => {
      updateCalls += 1;
      return { error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ default_model: "openai/gpt-5.4" }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "default_model must be enabled and available",
  });
  assert.equal(updateCalls, 0);
});

test("PATCH /api/settings saves enabled default models", async () => {
  const { createSettingsPatchHandler } = await loadSettingsRoute();
  const updates: Record<string, unknown>[] = [];

  const handler = createSettingsPatchHandler({
    requireUserId: async () => "user-123",
    canUserSetDefaultModel: async () => true,
    updateProfile: async (_userId, update) => {
      updates.push(update);
      return { error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ default_model: "minimax/minimax-m2.7" }),
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(updates, [{ default_model: "minimax/minimax-m2.7" }]);
});

test("PATCH /api/settings cascades the default-model change to automations when opted in", async () => {
  const { createSettingsPatchHandler } = await loadSettingsRoute();
  const cascadeCalls: Array<{
    userId: string;
    previousModelIds: string[];
    nextModelId: string;
  }> = [];

  const handler = createSettingsPatchHandler({
    requireUserId: async () => "user-123",
    canUserSetDefaultModel: async () => true,
    updateProfile: async () => ({ error: null }),
    loadStoredDefaultModel: async () => "openai/gpt-5.4",
    resolveStoredUserDefaultModelId: async () => "openai/gpt-5.4",
    cascadeAutomationModels: async (input) => {
      cascadeCalls.push(input);
      return { draftsUpdated: 3, versionsPublished: 2, failed: 0 };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_model: "minimax/minimax-m2.7",
        update_automation_models: true,
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    automations: { drafts_updated: 3, versions_published: 2, failed: 0 },
  });
  assert.deepEqual(cascadeCalls, [
    {
      userId: "user-123",
      previousModelIds: ["openai/gpt-5.4"],
      nextModelId: "minimax/minimax-m2.7",
    },
  ]);
});

test("PATCH /api/settings reports a cascade failure without failing the saved default", async () => {
  const { createSettingsPatchHandler } = await loadSettingsRoute();

  const handler = createSettingsPatchHandler({
    requireUserId: async () => "user-123",
    canUserSetDefaultModel: async () => true,
    updateProfile: async () => ({ error: null }),
    loadStoredDefaultModel: async () => "openai/gpt-5.4",
    resolveStoredUserDefaultModelId: async () => "openai/gpt-5.4",
    cascadeAutomationModels: async () => {
      throw new Error("db down");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_model: "minimax/minimax-m2.7",
        update_automation_models: true,
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    automation_update_error:
      "Default model saved, but updating automations failed",
  });
});

test("PATCH /api/settings ignores update_automation_models without a default model", async () => {
  const { createSettingsPatchHandler } = await loadSettingsRoute();
  let cascadeCalls = 0;

  const handler = createSettingsPatchHandler({
    requireUserId: async () => "user-123",
    canUserSetDefaultModel: async () => true,
    updateProfile: async () => ({ error: null }),
    cascadeAutomationModels: async () => {
      cascadeCalls += 1;
      return { draftsUpdated: 0, versionsPublished: 0, failed: 0 };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_automation_models: true }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "No valid fields" });
  assert.equal(cascadeCalls, 0);
});
