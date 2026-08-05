import assert from "node:assert/strict";
import test from "node:test";

async function loadWorkspaceRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/workspaces/[id]/route");
}

test("PATCH /api/workspaces/[id] normalizes disabled user billing to platform", async () => {
  const { createWorkspacePatchHandler } = await loadWorkspaceRoute();
  let receivedUpdates: Record<string, unknown> | null = null;

  const handler = createWorkspacePatchHandler({
    requireUserId: async () => "user-123",
    getWorkspaceForScope: (async () => ({ id: "ws-1" }) as never) as never,
    updateWorkspace: async (_id, _scope, updates) => {
      receivedUpdates = updates;
      return {
        data: {
          id: "ws-1",
          user_id: "user-123",
          name: "Workspace A",
          description: "Notes",
          is_default: false,
          sandbox_billing_mode: "platform",
          sandbox_vercel_project_id: null,
          sandbox_vercel_team_id: null,
          vercel_link_status: "unknown",
          vercel_link_checked_at: null,
          vercel_link_error_code: null,
          vercel_link_message: null,
          created_at: "2026-03-31T00:00:00.000Z",
          updated_at: "2026-03-31T00:00:00.000Z",
        },
        error: null,
      };
    },
    loadWorkspaceRepoCount: async () => 4,
  });

  const response = await handler(
    new Request("http://localhost/api/workspaces/ws-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sandbox_billing_mode: "user_vercel_project",
        sandbox_vercel_project_id: "prj_123",
        sandbox_vercel_team_id: "team_123",
      }),
    }),
    { params: Promise.resolve({ id: "ws-1" }) }
  );

  assert.equal(response.status, 200);
  assert.equal(receivedUpdates?.["sandbox_billing_mode"], "platform");
  assert.equal(receivedUpdates?.["sandbox_vercel_project_id"], null);
  assert.equal(receivedUpdates?.["sandbox_vercel_team_id"], null);
  assert.equal(receivedUpdates?.["vercel_link_status"], "unknown");
  assert.equal(receivedUpdates?.["vercel_link_checked_at"], null);
  assert.equal(receivedUpdates?.["vercel_link_error_code"], null);
  assert.equal(receivedUpdates?.["vercel_link_message"], null);
  assert.deepEqual(await response.json(), {
    id: "ws-1",
    user_id: "user-123",
    name: "Workspace A",
    description: "Notes",
    is_default: false,
    sandbox_billing_mode: "platform",
    sandbox_vercel_project_id: null,
    sandbox_vercel_team_id: null,
    vercel_link_status: "unknown",
    vercel_link_checked_at: null,
    vercel_link_error_code: null,
    vercel_link_message: null,
    created_at: "2026-03-31T00:00:00.000Z",
    updated_at: "2026-03-31T00:00:00.000Z",
    repo_count: 4,
  });
});
