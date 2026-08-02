import assert from "node:assert/strict";
import test from "node:test";

async function loadReposRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/repos/route");
}

const TEAM_UUID = "11111111-2222-3333-4444-555555555555";

const VIEWER_CAPS = new Set([
  "models.*",
  "tools.web_search",
  "tools.web_fetch",
  "tools.virtual_exec",
]);

const ADMIN_CAPS = new Set(["*"]);

test("GET /api/repos returns repos in personal scope when no team header is set", async () => {
  const { createReposGetHandler } = await loadReposRoute();
  let capturedScope: Record<string, unknown> | null = null;

  const handler = createReposGetHandler({
    requireUserId: async () => "user-123",
    loadRepos: async (scope) => {
      capturedScope = scope;
      return {
        data: [
          {
            id: "repo-1",
            full_name: "octocat/hello",
            github_id: 1,
            github_installation_id: null,
            is_favorite: false,
            is_hidden: false,
          },
        ],
        error: null,
      };
    },
    countGithubInstallations: async () => 0,
    hasGithubAppConfig: () => false,
  });

  const response = await handler(new Request("http://localhost/api/repos"));
  assert.equal(response.status, 200);
  assert.deepEqual(capturedScope, {
    kind: "personal",
    userId: "user-123",
    productTeamId: null,
  });
  const body = (await response.json()) as Array<{ id: string }>;
  assert.equal(body.length, 1);
  assert.equal(body[0].id, "repo-1");
});

test("GET /api/repos allows team viewers to list repos (regression: was 403)", async () => {
  const { createReposGetHandler } = await loadReposRoute();
  let capturedScope: Record<string, unknown> | null = null;

  const handler = createReposGetHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_UUID,
      capabilities: VIEWER_CAPS,
    }),
    loadRepos: async (scope) => {
      capturedScope = scope;
      return {
        data: [
          {
            id: "repo-team",
            full_name: "team/proj",
            github_id: 2,
            github_installation_id: null,
          },
        ],
        error: null,
      };
    },
    countGithubInstallations: async () => 0,
    hasGithubAppConfig: () => false,
  });

  const response = await handler(
    new Request("http://localhost/api/repos", {
      headers: { "x-mogplex-team-id": TEAM_UUID },
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(capturedScope, {
    kind: "team",
    userId: "user-123",
    productTeamId: TEAM_UUID,
  });
});

test("GET /api/repos returns 403 when the user is not a member of the active team", async () => {
  const { createReposGetHandler } = await loadReposRoute();

  const handler = createReposGetHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => ({
      ok: false,
      status: 403,
      error: "Forbidden",
    }),
    loadRepos: async () => {
      throw new Error("loadRepos should not be called when scope is denied");
    },
    countGithubInstallations: async () => 0,
    hasGithubAppConfig: () => false,
  });

  const response = await handler(
    new Request("http://localhost/api/repos", {
      headers: { "x-mogplex-team-id": TEAM_UUID },
    })
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
});

test("GET /api/repos falls back to personal scope when team header is not a UUID", async () => {
  const { createReposGetHandler } = await loadReposRoute();
  let capturedScope: Record<string, unknown> | null = null;
  let resolverCalls = 0;

  const handler = createReposGetHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => {
      resolverCalls += 1;
      return { ok: true, teamId: null };
    },
    loadRepos: async (scope) => {
      capturedScope = scope;
      return { data: [], error: null };
    },
    countGithubInstallations: async () => 0,
    hasGithubAppConfig: () => false,
  });

  const response = await handler(
    new Request("http://localhost/api/repos", {
      headers: { "x-mogplex-team-id": "not-a-uuid" },
    })
  );

  assert.equal(response.status, 200);
  assert.equal(resolverCalls, 0);
  assert.deepEqual(capturedScope, {
    kind: "personal",
    userId: "user-123",
    productTeamId: null,
  });
});

test("GET /api/repos returns a JSON 500 when loadRepos surfaces a DB error", async () => {
  const { createReposGetHandler } = await loadReposRoute();

  const handler = createReposGetHandler({
    requireUserId: async () => "user-123",
    // Mirror Supabase's failure shape: data present (often null/empty) and a
    // structured error. The handler must return the API's JSON envelope, not
    // let the throw escape into Next.js's default error page.
    loadRepos: async () => ({
      data: null,
      error: { message: "connection terminated" },
    }),
    countGithubInstallations: async () => 0,
    hasGithubAppConfig: () => false,
  });

  const response = await handler(new Request("http://localhost/api/repos"));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "connection terminated" });
});

test("POST /api/repos rejects team viewers without projects.write", async () => {
  const { createReposPostHandler } = await loadReposRoute();
  let inserted = false;

  const handler = createReposPostHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_UUID,
      capabilities: VIEWER_CAPS,
    }),
    insertRepo: async () => {
      inserted = true;
      return { data: null, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/repos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mogplex-team-id": TEAM_UUID,
      },
      body: JSON.stringify({
        full_name: "team/new",
        owner: "team",
        name: "new",
        github_id: 99,
      }),
    })
  );

  assert.equal(response.status, 403);
  assert.equal(inserted, false);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
});

test("POST /api/repos creates a team-owned repo when the caller is an admin", async () => {
  const { createReposPostHandler } = await loadReposRoute();
  let insertedPayload: Record<string, unknown> | null = null;

  const handler = createReposPostHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_UUID,
      capabilities: ADMIN_CAPS,
    }),
    ensureDefaultWorkspaceForUser: async (
      _userId: string,
      options?: { productTeamId?: string | null }
    ) => {
      assert.equal(options?.productTeamId, TEAM_UUID);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { id: "ws-team", is_default: true } as any;
    },
    insertRepo: async (payload) => {
      insertedPayload = payload;
      return {
        data: {
          id: "repo-team",
          full_name: payload.full_name as string,
          github_installation_id: null,
        },
        error: null,
      };
    },
    countGithubInstallations: async () => 0,
  });

  const response = await handler(
    new Request("http://localhost/api/repos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mogplex-team-id": TEAM_UUID,
      },
      body: JSON.stringify({
        full_name: "team/new",
        owner: "team",
        name: "new",
        github_id: 99,
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(insertedPayload?.["owner_type"], "team");
  assert.equal(insertedPayload?.["product_team_id"], TEAM_UUID);
  assert.equal(insertedPayload?.["created_by_user_id"], "user-123");
  assert.equal(insertedPayload?.["workspace_id"], "ws-team");
});

test("PATCH /api/repos rejects team viewers without projects.write", async () => {
  const { createReposPatchHandler } = await loadReposRoute();
  let updated = false;

  const handler = createReposPatchHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_UUID,
      capabilities: VIEWER_CAPS,
    }),
    updateRepo: async () => {
      updated = true;
      return { data: null, error: null };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/repos", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-mogplex-team-id": TEAM_UUID,
      },
      body: JSON.stringify({ id: "repo-1", is_favorite: true }),
    })
  );

  assert.equal(response.status, 403);
  assert.equal(updated, false);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
});

test("PATCH /api/repos returns 404 when the row is outside the active scope", async () => {
  const { createReposPatchHandler } = await loadReposRoute();

  const handler = createReposPatchHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_UUID,
      capabilities: ADMIN_CAPS,
    }),
    // Scope-mismatched updates return data: null with no error; the route
    // must surface that as 404 rather than dereferencing null.
    updateRepo: async () => ({ data: null, error: null }),
    countGithubInstallations: async () => 0,
  });

  const response = await handler(
    new Request("http://localhost/api/repos", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-mogplex-team-id": TEAM_UUID,
      },
      body: JSON.stringify({ id: "repo-1", is_favorite: true }),
    })
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Repo not found" });
});

test("POST /api/repos returns 500 when insertRepo yields no row", async () => {
  const { createReposPostHandler } = await loadReposRoute();

  const handler = createReposPostHandler({
    requireUserId: async () => "user-123",
    ensureDefaultWorkspaceForUser: async () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ id: "ws-1", is_default: true }) as any,
    insertRepo: async () => ({ data: null, error: null }),
    countGithubInstallations: async () => 0,
  });

  const response = await handler(
    new Request("http://localhost/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: "u/new",
        owner: "u",
        name: "new",
        github_id: 1,
      }),
    })
  );

  assert.equal(response.status, 500);
});

test("DELETE /api/repos rejects team viewers (regression: was unprotected)", async () => {
  const { createReposDeleteHandler } = await loadReposRoute();
  let deleted = false;

  const handler = createReposDeleteHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_UUID,
      capabilities: VIEWER_CAPS,
    }),
    deleteRepo: async () => {
      deleted = true;
      return { error: null };
    },
  });

  const response = await handler(
    new Request(`http://localhost/api/repos?id=repo-1`, {
      method: "DELETE",
      headers: { "x-mogplex-team-id": TEAM_UUID },
    })
  );

  assert.equal(response.status, 403);
  assert.equal(deleted, false);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
});

test("DELETE /api/repos succeeds for team admins", async () => {
  const { createReposDeleteHandler } = await loadReposRoute();
  let capturedScope: Record<string, unknown> | null = null;
  let capturedId: string | null = null;

  const handler = createReposDeleteHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_UUID,
      capabilities: ADMIN_CAPS,
    }),
    deleteRepo: async (id, scope) => {
      capturedId = id;
      capturedScope = scope;
      return { error: null };
    },
  });

  const response = await handler(
    new Request(`http://localhost/api/repos?id=repo-1`, {
      method: "DELETE",
      headers: { "x-mogplex-team-id": TEAM_UUID },
    })
  );

  assert.equal(response.status, 200);
  assert.equal(capturedId, "repo-1");
  assert.deepEqual(capturedScope, {
    kind: "team",
    userId: "user-123",
    productTeamId: TEAM_UUID,
  });
});
