import assert from "node:assert/strict";
import test from "node:test";

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/flows/route");
}

const trigger = {
  id: "review",
  name: "PR-Review",
  filter: { scope: "all" as const },
};

test("GET /api/flows?view=triggers returns trigger filters without building flow summaries", async () => {
  const { createFlowsGetHandler } = await loadRoute();
  const handler = createFlowsGetHandler({
    requireUserId: async () => "user-1",
    listOwnedFlowsWithSummaries: async () => {
      throw new Error("summaries must not load for the triggers view");
    },
    listGithubAutomationTriggers: async (userId) => {
      assert.equal(userId, "user-1");
      return [trigger];
    },
  });

  const response = await handler(
    new Request("http://localhost/api/flows?view=triggers")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [trigger]);
});

test("GET /api/flows still returns flow summaries without a view", async () => {
  const { createFlowsGetHandler } = await loadRoute();
  const handler = createFlowsGetHandler({
    requireUserId: async () => "user-1",
    listOwnedFlowsWithSummaries: async () => [],
    listGithubAutomationTriggers: async () => {
      throw new Error("triggers must not load without the view");
    },
  });

  const response = await handler(new Request("http://localhost/api/flows"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});
