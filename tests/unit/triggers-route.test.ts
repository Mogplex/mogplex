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

test("PUT /api/triggers reports a failed agent slug write", async () => {
  const { createTriggersPutHandler } = await loadTriggersRoute();
  const handler = createTriggersPutHandler({
    requireUserId: async () => "user-123",
    loadOwnedAgent: async () => ({
      id: "agent-123",
      name: "Review Pull Requests",
      slug: null,
    }),
    updateAgentSlug: async () => {
      throw new Error("slug write failed");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/triggers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "trigger-123",
        agent_id: "agent-123",
      }),
    })
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Failed to prepare agent",
  });
});

test("PUT /api/triggers reports a failed agent ownership lookup", async () => {
  const { createTriggersPutHandler } = await loadTriggersRoute();
  const handler = createTriggersPutHandler({
    requireUserId: async () => "user-123",
    loadOwnedAgent: async () => {
      throw new Error("database unavailable");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/triggers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "trigger-123",
        agent_id: "agent-123",
      }),
    })
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Failed to load agent" });
});

test("POST /api/triggers reports a failed installation ownership lookup", async () => {
  const { createTriggersPostHandler } = await loadTriggersRoute();
  const handler = createTriggersPostHandler({
    requireUserId: async () => "user-123",
    loadOwnedInstallation: async () => {
      throw new Error("database unavailable");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installation_id: 123,
        agent_id: "agent-123",
        event: "push",
      }),
    })
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Failed to load installation",
  });
});
