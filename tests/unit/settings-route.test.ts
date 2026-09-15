import { NextResponse } from "next/server";
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

test("PATCH saves only the explicitly selected destinations", async () => {
  const { createSettingsPatchHandler } = await loadSettingsRoute();
  let saved: unknown;
  const handler = createSettingsPatchHandler({
    requireUserId: async () => "user-123",
    canUserSetDefaultModel: async () => true,
    applyModelDefaults: async (input) => {
      saved = input;
      return { drafts_updated: 1, versions_published: 1 };
    },
  });
  const id = "00000000-0000-4000-8000-000000000003";
  const response = await handler(
    request({
      default_model: "openai/gpt-5.4",
      apply_to_surfaces: ["cli", "slack"],
      automation_ids: [id, id],
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(saved, {
    userId: "user-123",
    model: "openai/gpt-5.4",
    surfaces: ["cli", "slack"],
    flowIds: [id],
  });
  assert.deepEqual(await response.json(), {
    ok: true,
    automations: { drafts_updated: 1, versions_published: 1 },
  });
  await handler(request({ default_model: "openai/gpt-5.4" }));
  assert.deepEqual(saved, {
    userId: "user-123",
    model: "openai/gpt-5.4",
    surfaces: [],
    flowIds: [],
  });
});

function request(body: unknown) {
  return new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("PATCH rejects invalid destinations before writing, and requires authentication", async () => {
  const { createSettingsPatchHandler } = await loadSettingsRoute();
  const handler = createSettingsPatchHandler({
    requireUserId: async () => "user-123",
    applyModelDefaults: async () => {
      throw new Error("must not write");
    },
  });
  for (const body of [
    null,
    [],
    { apply_to_surfaces: ["unknown"] },
    { automation_ids: ["bad"] },
    { apply_to_surfaces: "cli" },
  ]) {
    assert.equal((await handler(request(body))).status, 400);
  }
  assert.equal(
    (
      await handler(
        request({ default_model: "test", update_automation_models: true })
      )
    ).status,
    409
  );
  const unauthorized = createSettingsPatchHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
  assert.equal(
    (await unauthorized(request({ default_model: "test" }))).status,
    401
  );
});

test("PATCH reports failure as a failed save, and preserves theme-only changes", async () => {
  const { createSettingsPatchHandler } = await loadSettingsRoute();
  const handler = createSettingsPatchHandler({
    requireUserId: async () => "user-123",
    canUserSetDefaultModel: async () => true,
    applyModelDefaults: async () => {
      throw new Error("storage failed");
    },
    updateProfile: async () => ({ error: null }),
  });
  const failed = await handler(request({ default_model: "test" }));
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {
    error: "Unable to save model settings. No changes were applied.",
  });
  const theme = await handler(request({ theme: "light" }));
  assert.equal(theme.status, 200);
  assert.match(theme.headers.get("set-cookie") ?? "", /light/);
});

test("model destinations route protects auth and surfaces loading failures", async () => {
  const { createModelTargetsGetHandler } =
    await import("../../app/api/settings/model-targets/route");
  const targets = { surfaces: [], automations: [] };
  assert.deepEqual(
    await (
      await createModelTargetsGetHandler({
        requireUserId: async () => "u",
        loadModelSettingsTargets: async () => targets,
      })()
    ).json(),
    targets
  );
  assert.equal(
    (
      await createModelTargetsGetHandler({
        requireUserId: async () =>
          NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        loadModelSettingsTargets: async () => targets,
      })()
    ).status,
    401
  );
  assert.equal(
    (
      await createModelTargetsGetHandler({
        requireUserId: async () => "u",
        loadModelSettingsTargets: async () => {
          throw new Error("db");
        },
      })()
    ).status,
    500
  );
});
