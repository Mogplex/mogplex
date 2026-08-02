import assert from "node:assert/strict";
import test from "node:test";

const TEAM_ID = "11111111-2222-4333-8444-555555555555";

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/flows/templates/route");
}

test("GET /api/flows/templates lists templates from the active team scope", async () => {
  const { createFlowTemplatesGetHandler } = await loadRoute();
  let loadedScope: Record<string, unknown> | null = null;

  const handler = createFlowTemplatesGetHandler({
    requireUserId: async () => "user-1",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_ID,
      capabilities: new Set(["models.*"]),
    }),
    listFlowTemplates: async (scope, cursor) => {
      loadedScope = scope;
      assert.equal(cursor, 0);
      return { templates: [], next_cursor: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/flows/templates", {
      headers: { "x-mogplex-team-id": TEAM_ID },
    })
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).can_write, false);
  assert.deepEqual(loadedScope, {
    kind: "team",
    userId: "user-1",
    productTeamId: TEAM_ID,
  });
});

test("POST /api/flows/templates rejects team viewers", async () => {
  const { createFlowTemplatesPostHandler } = await loadRoute();
  let created = false;

  const handler = createFlowTemplatesPostHandler({
    requireUserId: async () => "user-1",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_ID,
      capabilities: new Set(["models.*"]),
    }),
    createFlowTemplate: async () => {
      created = true;
      throw new Error("should not create");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/flows/templates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mogplex-team-id": TEAM_ID,
      },
      body: JSON.stringify({ flow_id: "flow-1", name: "Team review" }),
    })
  );

  assert.equal(response.status, 403);
  assert.equal(created, false);
});

test("POST /api/flows/templates saves into a writable team scope", async () => {
  const { createFlowTemplatesPostHandler } = await loadRoute();
  let createdInput: Record<string, unknown> | null = null;

  const handler = createFlowTemplatesPostHandler({
    requireUserId: async () => "user-1",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_ID,
      capabilities: new Set(["projects.write"]),
    }),
    createFlowTemplate: async (input) => {
      createdInput = input;
      return { id: "template-team", name: "Team review" } as never;
    },
  });

  const response = await handler(
    new Request("http://localhost/api/flows/templates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mogplex-team-id": TEAM_ID,
      },
      body: JSON.stringify({ flow_id: "flow-1", name: "Team review" }),
    })
  );

  assert.equal(response.status, 201);
  assert.deepEqual(createdInput, {
    userId: "user-1",
    flowId: "flow-1",
    name: "Team review",
    scope: {
      kind: "team",
      userId: "user-1",
      productTeamId: TEAM_ID,
    },
  });
});

test("DELETE /api/flows/templates/:id rejects team viewers", async () => {
  const { createFlowTemplateDeleteHandler } =
    await import("../../app/api/flows/templates/[id]/route");
  let deleted = false;
  const handler = createFlowTemplateDeleteHandler({
    requireUserId: async () => "user-1",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_ID,
      capabilities: new Set(["models.*"]),
    }),
    deleteFlowTemplate: async () => {
      deleted = true;
      return true;
    },
  });

  const response = await handler(
    new Request("http://localhost/api/flows/templates/template-team", {
      method: "DELETE",
      headers: { "x-mogplex-team-id": TEAM_ID },
    }),
    { params: Promise.resolve({ id: "template-team" }) }
  );

  assert.equal(response.status, 403);
  assert.equal(deleted, false);
});

test("DELETE /api/flows/templates/:id deletes inside the active team scope", async () => {
  const { createFlowTemplateDeleteHandler } =
    await import("../../app/api/flows/templates/[id]/route");
  let deletedScope: Record<string, unknown> | null = null;
  const handler = createFlowTemplateDeleteHandler({
    requireUserId: async () => "user-1",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_ID,
      capabilities: new Set(["projects.write"]),
    }),
    deleteFlowTemplate: async (scope, id) => {
      deletedScope = scope;
      assert.equal(id, "template-team");
      return true;
    },
  });

  const response = await handler(
    new Request("http://localhost/api/flows/templates/template-team", {
      method: "DELETE",
      headers: { "x-mogplex-team-id": TEAM_ID },
    }),
    { params: Promise.resolve({ id: "template-team" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(deletedScope, {
    kind: "team",
    userId: "user-1",
    productTeamId: TEAM_ID,
  });
});

test("POST /api/flows resolves team template use through active membership", async () => {
  const { createFlowsPostHandler } = await import("../../app/api/flows/route");
  let createInput: Record<string, unknown> | null = null;
  const handler = createFlowsPostHandler({
    requireUserId: async () => "user-1",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_ID,
      capabilities: new Set(["models.*"]),
    }),
    createFlowForUser: async (input) => {
      createInput = input;
      return { id: "flow-created" } as never;
    },
  });

  const response = await handler(
    new Request("http://localhost/api/flows", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mogplex-team-id": TEAM_ID,
      },
      body: JSON.stringify({
        installation_id: 101,
        team_template_id: "template-team",
      }),
    })
  );

  assert.equal(response.status, 201);
  assert.equal(createInput?.["teamTemplateId"], "template-team");
  assert.equal(createInput?.["teamId"], TEAM_ID);
});

test("POST /api/flows rejects team template use without an active team", async () => {
  const { createFlowsPostHandler } = await import("../../app/api/flows/route");
  let created = false;
  const handler = createFlowsPostHandler({
    requireUserId: async () => "user-1",
    createFlowForUser: async () => {
      created = true;
      return { id: "flow-created" } as never;
    },
  });

  const response = await handler(
    new Request("http://localhost/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installation_id: 101,
        team_template_id: "template-team",
      }),
    })
  );

  assert.equal(response.status, 400);
  assert.equal(created, false);
});
