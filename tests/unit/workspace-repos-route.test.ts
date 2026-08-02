import assert from "node:assert/strict";
import test from "node:test";

async function loadWorkspaceRepoRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/workspaces/[id]/repos/route");
}

test("POST /api/workspaces/[id]/repos returns 404 for workspaces the caller does not own", async () => {
  const { createWorkspaceRepoPostHandler } = await loadWorkspaceRepoRoute();
  let githubCreates = 0;

  const handler = createWorkspaceRepoPostHandler({
    requireUserId: async () => "user-123",
    getWorkspaceForScope: async () => null,
    createGithubRepo: async () => {
      githubCreates += 1;
      throw new Error("createGithubRepo should not be called");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/workspaces/ws-1/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "demo-app" }),
    }),
    { params: Promise.resolve({ id: "ws-1" }) }
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Workspace not found" });
  assert.equal(githubCreates, 0);
});

test("POST /api/workspaces/[id]/repos returns 400 when GitHub is not connected", async () => {
  const { createWorkspaceRepoPostHandler } = await loadWorkspaceRepoRoute();

  const handler = createWorkspaceRepoPostHandler({
    requireUserId: async () => "user-123",
    getWorkspaceForScope: async () => ({ id: "ws-1", name: "Product Alpha" }),
    getGithubToken: async () => null,
  });

  const response = await handler(
    new Request("http://localhost/api/workspaces/ws-1/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "demo-app" }),
    }),
    { params: Promise.resolve({ id: "ws-1" }) }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Connect GitHub account first",
  });
});

test("POST /api/workspaces/[id]/repos creates a repo in the selected workspace", async () => {
  const { createWorkspaceRepoPostHandler } = await loadWorkspaceRepoRoute();
  let createInput: Record<string, unknown> | null = null;
  let upsertInput: Record<string, unknown> | null = null;

  const handler = createWorkspaceRepoPostHandler({
    requireUserId: async () => "user-123",
    getWorkspaceForScope: async () => ({ id: "ws-1", name: "Product Alpha" }),
    getGithubToken: async () => "github-token",
    loadGithubProfile: async () => ({ github_username: "alex" }),
    loadGithubInstallations: async () => [
      {
        installation_id: 99,
        account_login: "acme",
        account_type: "Organization",
        target_type: "Organization",
      },
    ],
    fetchGithubCurrentUserLogin: async () => "alex",
    fetchGithubUserOrgs: async () => ["acme"],
    createGithubRepo: async (_token, input) => {
      createInput = input;
      return {
        id: 123,
        full_name: "acme/demo-app",
        default_branch: "main",
        owner: { login: "acme" },
        name: "demo-app",
      };
    },
    upsertGithubReposForUser: async (userId, repos, options) => {
      upsertInput = {
        userId,
        repos,
        options,
      };
    },
    loadWorkspaceRepoByGithubId: async () => ({
      id: "repo-123",
      workspace_id: "ws-1",
      full_name: "acme/demo-app",
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/workspaces/ws-1/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "demo-app",
        owner_login: "acme",
        visibility: "private",
        description: "Project repo",
      }),
    }),
    { params: Promise.resolve({ id: "ws-1" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(createInput, {
    owner: "acme",
    name: "demo-app",
    description: "Project repo",
    visibility: "private",
  });
  assert.deepEqual(upsertInput, {
    userId: "user-123",
    repos: [
      {
        id: 123,
        full_name: "acme/demo-app",
        default_branch: "main",
        owner: { login: "acme" },
        name: "demo-app",
      },
    ],
    options: {
      githubInstallationId: 99,
      workspaceId: "ws-1",
      productTeamId: null,
    },
  });
  assert.deepEqual(await response.json(), {
    id: "repo-123",
    workspace_id: "ws-1",
    full_name: "acme/demo-app",
  });
});

test("POST /api/workspaces/[id]/repos creates team-scoped repo rows", async () => {
  const { createWorkspaceRepoPostHandler } = await loadWorkspaceRepoRoute();
  let workspaceScope: Record<string, unknown> | null = null;
  let upsertOptions: Record<string, unknown> | null | undefined = null;
  let loadRepoScope: Record<string, unknown> | null = null;

  const handler = createWorkspaceRepoPostHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async (userId, teamId) => {
      assert.equal(userId, "user-123");
      assert.equal(teamId, "00000000-0000-4000-8000-000000000123");
      return { ok: true, teamId, capabilities: new Set(["*"]) };
    },
    getWorkspaceForScope: async (_workspaceId, scope) => {
      workspaceScope = scope;
      return { id: "ws-team", name: "Team Project" };
    },
    getGithubToken: async () => "github-token",
    loadGithubProfile: async () => ({ github_username: "alex" }),
    loadGithubInstallations: async () => [],
    fetchGithubCurrentUserLogin: async () => "alex",
    fetchGithubUserOrgs: async () => [],
    createGithubRepo: async () => ({
      id: 456,
      full_name: "alex/team-demo",
      default_branch: "main",
      owner: { login: "alex" },
      name: "team-demo",
    }),
    upsertGithubReposForUser: async (_userId, _repos, options) => {
      upsertOptions = options;
    },
    loadWorkspaceRepoByGithubId: async (scope) => {
      loadRepoScope = scope;
      return {
        id: "repo-team",
        workspace_id: "ws-team",
        full_name: "alex/team-demo",
      };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/workspaces/ws-team/repos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mogplex-team-id": "00000000-0000-4000-8000-000000000123",
      },
      body: JSON.stringify({
        name: "team-demo",
        owner_login: "alex",
      }),
    }),
    { params: Promise.resolve({ id: "ws-team" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(workspaceScope, {
    kind: "team",
    userId: "user-123",
    productTeamId: "00000000-0000-4000-8000-000000000123",
  });
  assert.deepEqual(upsertOptions, {
    githubInstallationId: null,
    workspaceId: "ws-team",
    productTeamId: "00000000-0000-4000-8000-000000000123",
  });
  assert.deepEqual(loadRepoScope, workspaceScope);
  assert.deepEqual(await response.json(), {
    id: "repo-team",
    workspace_id: "ws-team",
    full_name: "alex/team-demo",
  });
});
