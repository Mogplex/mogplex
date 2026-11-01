import assert from "node:assert/strict";
import test from "node:test";
import type { GithubRepoOwnerTarget } from "../../lib/github-owners";

async function loadWorkspaceRepoRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/workspaces/[id]/repos/route");
}

async function oauthOnlyCredential() {
  const { resolveGithubRepoCreateCredential } =
    await import("../../lib/github-repo-create-credential");
  return (target: GithubRepoOwnerTarget, token: string) =>
    resolveGithubRepoCreateCredential(target, token, {
      appConfigured: () => false,
    });
}

const owners = (
  targets: GithubRepoOwnerTarget[],
  oauthScopes: string[] | null = null
) => ({ targets, oauthScopes });

const acmeTarget: GithubRepoOwnerTarget = {
  login: "acme",
  kind: "org",
  github_installation_id: 99,
  scope_label: "Org",
  source: "oauth+installation",
};
const alexTarget: GithubRepoOwnerTarget = {
  login: "alex",
  kind: "personal",
  github_installation_id: null,
  scope_label: "Personal",
  source: "oauth",
};

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

test("POST /api/workspaces/[id]/repos requires an owner instead of defaulting to the personal account", async () => {
  const { createWorkspaceRepoPostHandler } = await loadWorkspaceRepoRoute();

  const handler = createWorkspaceRepoPostHandler({
    requireUserId: async () => "user-123",
    getWorkspaceForScope: async () => ({ id: "ws-1", name: "Product Alpha" }),
    getGithubToken: async () => {
      throw new Error("must not resolve a target without an owner");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/workspaces/ws-1/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "demo-app", owner_login: "  " }),
    }),
    { params: Promise.resolve({ id: "ws-1" }) }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Choose a GitHub account for the repository",
  });
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
      body: JSON.stringify({ name: "demo-app", owner_login: "alex" }),
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
    appConfigured: () => false,
    loadOwnerTargets: async () => owners([alexTarget, acmeTarget]),
    resolveCreateCredential: await oauthOnlyCredential(),
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
    appConfigured: () => false,
    loadOwnerTargets: async () => owners([alexTarget]),
    resolveCreateCredential: await oauthOnlyCredential(),
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

async function appModeHandler(created: string[]) {
  const { createWorkspaceRepoPostHandler } = await loadWorkspaceRepoRoute();
  const { resolveGithubRepoCreateCredential } =
    await import("../../lib/github-repo-create-credential");
  return createWorkspaceRepoPostHandler({
    requireUserId: async () => "user-123",
    getWorkspaceForScope: async () => ({ id: "ws-1", name: "Product Alpha" }),
    getGithubToken: async () => "identity-token",
    // "locked" is not an owner the user can resolve.
    appConfigured: () => true,
    loadAppCreateTarget: async (_userId, _token, ownerLogin) => ({
      target:
        [alexTarget, acmeTarget].find(
          (target) => target.login === (ownerLogin ?? "alex")
        ) ?? null,
      oauthScopes: null,
    }),
    resolveCreateCredential: (target, token) =>
      resolveGithubRepoCreateCredential(target, token, {
        appConfigured: () => true,
        createInstallationToken: async (id) => ({
          token: `installation-${id}`,
        }),
        fetchOrgMembership: async () => ({ role: "admin", state: "active" }),
      }),
    createGithubRepo: async (token, input) => {
      created.push(`${token}:${input.owner}/${input.name}`);
      return {
        id: 321,
        full_name: `${input.owner}/${input.name}`,
        default_branch: "main",
        owner: { login: input.owner ?? "alex" },
        name: input.name,
      };
    },
    upsertGithubReposForUser: async () => {},
    loadWorkspaceRepoByGithubId: async () => ({ id: "repo-321" }),
  });
}

function createRequest(ownerLogin: string) {
  return new Request("http://localhost/api/workspaces/ws-1/repos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "demo-app", owner_login: ownerLogin }),
  });
}

test("POST /api/workspaces/[id]/repos creates an org repo with the installation token in an App deployment", async () => {
  const created: string[] = [];
  const handler = await appModeHandler(created);
  const response = await handler(createRequest("acme"), {
    params: Promise.resolve({ id: "ws-1" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(created, ["installation-99:acme/demo-app"]);
});

test("POST /api/workspaces/[id]/repos refuses a personal repo in an App deployment", async () => {
  const created: string[] = [];
  const handler = await appModeHandler(created);
  const response = await handler(createRequest("alex"), {
    params: Promise.resolve({ id: "ws-1" }),
  });
  assert.equal(response.status, 403);
  assert.equal(
    (await response.json()).code,
    "GITHUB_APP_USER_AUTHORIZATION_REQUIRED"
  );
  assert.deepEqual(created, []);
});

test("POST /api/workspaces/[id]/repos refuses an org the user cannot create in", async () => {
  const created: string[] = [];
  const handler = await appModeHandler(created);
  const response = await handler(createRequest("locked"), {
    params: Promise.resolve({ id: "ws-1" }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(created, []);
});

test("POST /api/workspaces/[id]/repos adopts a repository a previous attempt already created", async () => {
  const { createWorkspaceRepoPostHandler } = await loadWorkspaceRepoRoute();
  const { GithubRepoCreateError } = await import("../../lib/github-create");
  const existing = {
    id: 777,
    full_name: "acme/demo-app",
    default_branch: "main",
    owner: { login: "acme" },
    name: "demo-app",
    created_at: new Date().toISOString(),
    size: 0,
  };
  let imported: unknown = null;
  const handler = createWorkspaceRepoPostHandler({
    requireUserId: async () => "user-123",
    getWorkspaceForScope: async () => ({ id: "ws-1", name: "Product Alpha" }),
    getGithubToken: async () => "github-token",
    appConfigured: () => false,
    loadOwnerTargets: async () => owners([alexTarget, acmeTarget]),
    resolveCreateCredential: await oauthOnlyCredential(),
    createGithubRepo: async () => {
      throw new GithubRepoCreateError(422, '{"message":"name already exists"}');
    },
    fetchGithubRepo: async () => existing,
    upsertGithubReposForUser: async (_userId, repos) => {
      imported = repos;
    },
    loadWorkspaceRepoByGithubId: async () => ({ id: "repo-777" }),
  });
  const response = await handler(
    new Request("http://localhost/api/workspaces/ws-1/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "demo-app", owner_login: "acme" }),
    }),
    { params: Promise.resolve({ id: "ws-1" }) }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(imported, [existing]);
});
