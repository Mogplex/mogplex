import assert from "node:assert/strict";
import test from "node:test";

async function loadWorkspacesRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/workspaces/route");
}

test("GET /api/workspaces returns repo counts per workspace", async () => {
  const { createWorkspacesGetHandler } = await loadWorkspacesRoute();

  const handler = createWorkspacesGetHandler({
    requireUserId: async () => "user-123",
    loadWorkspaces: async () => [
      {
        id: "ws-1",
        user_id: "user-123",
        name: "Imported Repos",
        description: null,
        is_default: true,
        created_at: "2026-03-25T00:00:00.000Z",
        updated_at: "2026-03-25T00:00:00.000Z",
      },
      {
        id: "ws-2",
        user_id: "user-123",
        name: "New Product",
        description: null,
        is_default: false,
        created_at: "2026-03-25T00:00:00.000Z",
        updated_at: "2026-03-25T00:00:00.000Z",
      },
    ],
    loadRepoWorkspaceIds: async () => [
      { workspace_id: "ws-1" },
      { workspace_id: "ws-1" },
      { workspace_id: "ws-2" },
    ],
  });

  const response = await handler();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    {
      id: "ws-1",
      user_id: "user-123",
      name: "Imported Repos",
      description: null,
      is_default: true,
      created_at: "2026-03-25T00:00:00.000Z",
      updated_at: "2026-03-25T00:00:00.000Z",
      repo_count: 2,
    },
    {
      id: "ws-2",
      user_id: "user-123",
      name: "New Product",
      description: null,
      is_default: false,
      created_at: "2026-03-25T00:00:00.000Z",
      updated_at: "2026-03-25T00:00:00.000Z",
      repo_count: 1,
    },
  ]);
});

test("GET /api/workspaces scopes rows to the active team", async () => {
  const { createWorkspacesGetHandler } = await loadWorkspacesRoute();
  let loadedScope: Record<string, unknown> | null = null;

  const handler = createWorkspacesGetHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async (userId, teamId) => {
      assert.equal(userId, "user-123");
      assert.equal(teamId, "00000000-0000-4000-8000-000000000123");
      return { ok: true, teamId, capabilities: new Set(["*"]) };
    },
    loadWorkspaces: async (scope) => {
      loadedScope = scope;
      return [
        {
          id: "ws-team",
          user_id: "user-123",
          owner_type: "team",
          owner_user_id: null,
          product_team_id: "00000000-0000-4000-8000-000000000123",
          created_by_user_id: "user-123",
          name: "Team Project",
          description: null,
          is_default: true,
          created_at: "2026-05-18T00:00:00.000Z",
          updated_at: "2026-05-18T00:00:00.000Z",
        },
      ];
    },
    loadRepoWorkspaceIds: async () => [{ workspace_id: "ws-team" }],
  });

  const response = await handler(
    new Request("http://localhost/api/workspaces", {
      headers: { "x-mogplex-team-id": "00000000-0000-4000-8000-000000000123" },
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(loadedScope, {
    kind: "team",
    userId: "user-123",
    productTeamId: "00000000-0000-4000-8000-000000000123",
  });
  assert.deepEqual(await response.json(), [
    {
      id: "ws-team",
      user_id: "user-123",
      owner_type: "team",
      owner_user_id: null,
      product_team_id: "00000000-0000-4000-8000-000000000123",
      created_by_user_id: "user-123",
      name: "Team Project",
      description: null,
      is_default: true,
      created_at: "2026-05-18T00:00:00.000Z",
      updated_at: "2026-05-18T00:00:00.000Z",
      repo_count: 1,
    },
  ]);
});

test("POST /api/workspaces rejects blank names", async () => {
  const { createWorkspacesPostHandler } = await loadWorkspacesRoute();
  let insertCalls = 0;

  const handler = createWorkspacesPostHandler({
    requireUserId: async () => "user-123",
    insertWorkspace: async () => {
      insertCalls += 1;
      return { data: null, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Workspace name is required",
  });
  assert.equal(insertCalls, 0);
});

test("POST /api/workspaces creates a normalized workspace", async () => {
  const { createWorkspacesPostHandler } = await loadWorkspacesRoute();
  let insertedPayload: Record<string, unknown> | null = null;

  const handler = createWorkspacesPostHandler({
    requireUserId: async () => "user-123",
    insertWorkspace: async (payload) => {
      insertedPayload = payload;
      return {
        data: {
          id: "ws-1",
          user_id: "user-123",
          name: payload.name,
          description: payload.description,
          is_default: false,
          created_at: "2026-03-25T00:00:00.000Z",
          updated_at: "2026-03-25T00:00:00.000Z",
        },
        error: null,
      };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "  Product Alpha  ",
        description: "  Main initiative  ",
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(insertedPayload?.["name"], "Product Alpha");
  assert.equal(insertedPayload?.["user_id"], "user-123");
  assert.equal(insertedPayload?.["owner_type"], "user");
  assert.equal(insertedPayload?.["owner_user_id"], "user-123");
  assert.equal(insertedPayload?.["product_team_id"], null);
  assert.equal(insertedPayload?.["created_by_user_id"], "user-123");
  assert.equal(insertedPayload?.["description"], "Main initiative");
  assert.equal(insertedPayload?.["sandbox_billing_mode"], "platform");
  assert.equal(insertedPayload?.["sandbox_vercel_project_id"], null);
  assert.equal(insertedPayload?.["sandbox_vercel_team_id"], null);
  assert.equal(insertedPayload?.["vercel_link_status"], "unknown");
  assert.equal(insertedPayload?.["vercel_link_checked_at"], null);
  assert.equal(insertedPayload?.["vercel_link_error_code"], null);
  assert.equal(insertedPayload?.["vercel_link_message"], null);
  assert.deepEqual(await response.json(), {
    id: "ws-1",
    user_id: "user-123",
    name: "Product Alpha",
    description: "Main initiative",
    is_default: false,
    created_at: "2026-03-25T00:00:00.000Z",
    updated_at: "2026-03-25T00:00:00.000Z",
    repo_count: 0,
  });
});

test("POST /api/workspaces creates a team-owned workspace in team scope", async () => {
  const { createWorkspacesPostHandler } = await loadWorkspacesRoute();
  let insertedPayload: Record<string, unknown> | null = null;

  const handler = createWorkspacesPostHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: "00000000-0000-4000-8000-000000000123",
      capabilities: new Set(["*"]),
    }),
    insertWorkspace: async (payload) => {
      insertedPayload = payload;
      return {
        data: {
          id: "ws-team",
          user_id: payload.user_id,
          owner_type: payload.owner_type,
          owner_user_id: payload.owner_user_id,
          product_team_id: payload.product_team_id,
          created_by_user_id: payload.created_by_user_id,
          name: payload.name,
          description: payload.description,
          is_default: false,
          created_at: "2026-05-18T00:00:00.000Z",
          updated_at: "2026-05-18T00:00:00.000Z",
        },
        error: null,
      };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/workspaces", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mogplex-team-id": "00000000-0000-4000-8000-000000000123",
      },
      body: JSON.stringify({ name: "A16Z Trial" }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(insertedPayload?.["owner_type"], "team");
  assert.equal(insertedPayload?.["owner_user_id"], null);
  assert.equal(
    insertedPayload?.["product_team_id"],
    "00000000-0000-4000-8000-000000000123"
  );
  assert.equal(insertedPayload?.["created_by_user_id"], "user-123");
  assert.deepEqual(await response.json(), {
    id: "ws-team",
    user_id: "user-123",
    owner_type: "team",
    owner_user_id: null,
    product_team_id: "00000000-0000-4000-8000-000000000123",
    created_by_user_id: "user-123",
    name: "A16Z Trial",
    description: null,
    is_default: false,
    created_at: "2026-05-18T00:00:00.000Z",
    updated_at: "2026-05-18T00:00:00.000Z",
    repo_count: 0,
  });
});

test("POST /api/workspaces rejects team members without project write capability", async () => {
  const { createWorkspacesPostHandler } = await loadWorkspacesRoute();
  let inserted = false;

  const handler = createWorkspacesPostHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: "00000000-0000-4000-8000-000000000123",
      capabilities: new Set(["models.*"]),
    }),
    insertWorkspace: async () => {
      inserted = true;
      return { data: null, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/workspaces", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mogplex-team-id": "00000000-0000-4000-8000-000000000123",
      },
      body: JSON.stringify({ name: "Viewer Project" }),
    })
  );

  assert.equal(response.status, 403);
  assert.equal(inserted, false);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
});
