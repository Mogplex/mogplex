import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import type { GithubRepoOwnerTarget } from "../../lib/github-owners";

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/github/repos/route");
}

const TEAM_ID = "00000000-0000-4000-8000-000000000123";

const owners = (
  targets: GithubRepoOwnerTarget[],
  oauthScopes: string[] | null = null
) => ({ targets, oauthScopes });

async function credentialFor(
  appConfigured: boolean,
  target: GithubRepoOwnerTarget,
  token: string
) {
  const { resolveGithubRepoCreateCredential } =
    await import("../../lib/github-repo-create-credential");
  return resolveGithubRepoCreateCredential(target, token, {
    appConfigured: () => appConfigured,
    createInstallationToken: async (id) => ({ token: `installation-${id}` }),
    fetchOrgMembership: async () => ({ role: "admin", state: "active" }),
  });
}
const oauthOnlyCredential = (target: GithubRepoOwnerTarget, token: string) =>
  credentialFor(false, target, token);

function createRequest(ownerLogin: string) {
  return new Request("http://localhost/api/github/repos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner_login: ownerLogin, name: "widgets" }),
  });
}

test("POST /api/github/repos preserves authentication failures", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  let creates = 0;
  const handler = createGithubRepoPostHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    createGithubRepo: async () => {
      creates += 1;
      throw new Error("must not create");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/github/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner_login: "alex", name: "widgets" }),
    })
  );

  assert.equal(response.status, 401);
  assert.equal(creates, 0);
});

test("POST /api/github/repos rejects a null JSON body", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const handler = createGithubRepoPostHandler({
    requireUserId: async () => "user-123",
  });

  const response = await handler(
    new Request("http://localhost/api/github/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
});

test("POST /api/github/repos creates an org repo before returning its Mogplex row", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  let createInput: Record<string, unknown> | null = null;
  let upsertOptions: Record<string, unknown> | null | undefined = null;
  let loadedScope: Record<string, unknown> | null = null;
  const handler = createGithubRepoPostHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_ID,
      capabilities: new Set(["*"]),
    }),
    getGithubToken: async () => "github-token",
    appConfigured: () => false,
    resolveCreateCredential: oauthOnlyCredential,
    loadOwnerTargets: async () =>
      owners([
        {
          login: "acme",
          kind: "org",
          github_installation_id: 42,
          scope_label: "Org",
          source: "oauth+installation",
        },
      ]),
    createGithubRepo: async (_token, input) => {
      createInput = input;
      return {
        id: 123,
        full_name: "acme/Analytics-redesign",
        default_branch: "main",
        owner: { login: "acme" },
        name: "Analytics-redesign",
      };
    },
    upsertGithubReposForUser: async (_userId, _repos, options) => {
      upsertOptions = options;
    },
    loadRepoByGithubId: async (scope) => {
      loadedScope = scope;
      return {
        id: "repo-123",
        full_name: "acme/Analytics-redesign",
        owner: "acme",
        name: "Analytics-redesign",
        default_branch: "main",
      };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/github/repos", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mogplex-team-id": TEAM_ID,
      },
      body: JSON.stringify({
        owner_login: "acme",
        name: "Analytics / redesign",
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(createInput, {
    owner: "acme",
    name: "Analytics-redesign",
    visibility: "private",
  });
  assert.deepEqual(upsertOptions, {
    githubInstallationId: 42,
    productTeamId: TEAM_ID,
  });
  assert.deepEqual(loadedScope, {
    kind: "team",
    userId: "user-123",
    productTeamId: TEAM_ID,
  });
  assert.deepEqual(await response.json(), {
    id: "repo-123",
    full_name: "acme/Analytics-redesign",
    owner: "acme",
    name: "Analytics-redesign",
    default_branch: "main",
  });
});

test("POST /api/github/repos rejects owners that cannot create repos", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  let creates = 0;
  const handler = createGithubRepoPostHandler({
    requireUserId: async () => "user-123",
    getGithubToken: async () => "github-token",
    appConfigured: () => false,
    resolveCreateCredential: oauthOnlyCredential,
    loadOwnerTargets: async () => owners([]),
    createGithubRepo: async () => {
      creates += 1;
      throw new Error("must not create");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/github/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner_login: "acme", name: "widgets" }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Selected GitHub account is unavailable",
  });
  assert.equal(creates, 0);
});

test("POST /api/github/repos returns JSON when owner discovery fails", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const handler = createGithubRepoPostHandler({
    requireUserId: async () => "user-123",
    getGithubToken: async () => "github-token",
    appConfigured: () => false,
    resolveCreateCredential: oauthOnlyCredential,
    loadOwnerTargets: async () => {
      throw new Error("GitHub unavailable");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/github/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner_login: "acme", name: "widgets" }),
    })
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "GitHub accounts unavailable",
  });
});

test("POST /api/github/repos maps GitHub name collisions to 409", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const { GithubRepoCreateError } = await import("../../lib/github-create");
  const handler = createGithubRepoPostHandler({
    requireUserId: async () => "user-123",
    getGithubToken: async () => "github-token",
    appConfigured: () => false,
    resolveCreateCredential: oauthOnlyCredential,
    loadOwnerTargets: async () =>
      owners([
        {
          login: "alex",
          kind: "personal",
          github_installation_id: null,
          scope_label: "Personal",
          source: "oauth",
        },
      ]),
    createGithubRepo: async () => {
      throw new GithubRepoCreateError(
        422,
        JSON.stringify({
          message: "Repository creation failed",
          errors: [{ message: "name already exists" }],
        })
      );
    },
    fetchGithubRepo: async () => null,
  });

  const response = await handler(
    new Request("http://localhost/api/github/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner_login: "alex", name: "widgets" }),
    })
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Repository creation failed: name already exists",
  });
});

test("POST /api/github/repos reconciles a repository left by a partial create", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const { GithubRepoCreateError } = await import("../../lib/github-create");
  let importedGithubId: number | null = null;
  const handler = createGithubRepoPostHandler({
    requireUserId: async () => "user-123",
    getGithubToken: async () => "github-token",
    appConfigured: () => false,
    resolveCreateCredential: oauthOnlyCredential,
    loadOwnerTargets: async () =>
      owners([
        {
          login: "acme",
          kind: "org",
          github_installation_id: 42,
          scope_label: "Org",
          source: "oauth+installation",
        },
      ]),
    createGithubRepo: async () => {
      throw new GithubRepoCreateError(422, "name already exists");
    },
    fetchGithubRepo: async () => ({
      id: 456,
      full_name: "acme/widgets",
      name: "widgets",
      owner: { login: "acme" },
      default_branch: "main",
      created_at: new Date().toISOString(),
      size: 0,
    }),
    upsertGithubReposForUser: async (_userId, repos) => {
      importedGithubId = repos[0]?.id ?? null;
    },
    loadRepoByGithubId: async () => ({
      id: "repo-456",
      full_name: "acme/widgets",
      owner: "acme",
      name: "widgets",
      default_branch: "main",
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/github/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner_login: "acme", name: "widgets" }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(importedGithubId, 456);
  assert.equal((await response.json()).id, "repo-456");
});

test("POST /api/github/repos asks to reconnect when the identity grant cannot read orgs", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const handler = createGithubRepoPostHandler({
    appConfigured: () => false,
    requireUserId: async () => "user-123",
    getGithubToken: async () => "identity-token",
    loadOwnerTargets: async () =>
      owners(
        [
          {
            login: "alex",
            kind: "personal",
            github_installation_id: null,
            scope_label: "Personal",
            source: "oauth",
          },
        ],
        ["read:user", "user:email"]
      ),
  });
  const response = await handler(createRequest("acme"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "GITHUB_REAUTHORIZE_REQUIRED");
  assert.equal(
    response.headers.get("x-mogplex-github-reauthorize"),
    "read:org"
  );
});

test("POST /api/github/repos reports a failed connection lookup instead of asking to connect", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const originalError = console.error;
  console.error = () => {};
  try {
    const handler = createGithubRepoPostHandler({
      requireUserId: async () => "user-123",
      getGithubToken: async () => {
        throw new Error("Could not verify GitHub repository authorization");
      },
    });
    const response = await handler(createRequest("acme"));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Could not read your GitHub connection",
    });
  } finally {
    console.error = originalError;
  }
});
