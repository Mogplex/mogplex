import assert from "node:assert/strict";
import test from "node:test";
import { loadModelsRoute } from "./helpers/models-route-fixtures";

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
