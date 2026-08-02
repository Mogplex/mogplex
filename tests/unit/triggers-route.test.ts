import assert from "node:assert/strict";
import test from "node:test";

async function loadTriggersRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/triggers/route");
}

test("PUT /api/triggers rejects agent ids the caller does not own", async () => {
  const { createTriggersPutHandler } = await loadTriggersRoute();
  let slugUpdates = 0;

  const handler = createTriggersPutHandler({
    requireUserId: async () => "user-123",
    loadOwnedAgent: async () => null,
    updateAgentSlug: async () => {
      slugUpdates += 1;
    },
  });

  const response = await handler(
    new Request("http://localhost/api/triggers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "trigger-123",
        agent_id: "agent-foreign",
      }),
    })
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Agent not found" });
  assert.equal(slugUpdates, 0);
});
