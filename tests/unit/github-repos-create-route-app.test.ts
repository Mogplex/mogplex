import assert from "node:assert/strict";
import test from "node:test";
import type { GithubRepoOwnerTarget } from "../../lib/github-owners";
import { GithubRepoCreateError } from "../../lib/github-create";

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/github/repos/route");
}

const TEAM_ID = "00000000-0000-4000-8000-000000000123";

async function appCredential(target: GithubRepoOwnerTarget, token: string) {
  const { resolveGithubRepoCreateCredential } =
    await import("../../lib/github-repo-create-credential");
  return resolveGithubRepoCreateCredential(target, token, {
    appConfigured: () => true,
    createInstallationToken: async (id) => ({ token: `installation-${id}` }),
    fetchOrgMembership: async () => ({ role: "admin", state: "active" }),
  });
}

function appModeHandler(
  createGithubRepoPostHandler: Awaited<
    ReturnType<typeof loadRoute>
  >["createGithubRepoPostHandler"],
  tokens: string[],
  refuseCreate = false,
  overrides: Parameters<
    Awaited<ReturnType<typeof loadRoute>>["createGithubRepoPostHandler"]
  >[0] = {}
) {
  return createGithubRepoPostHandler({
    requireUserId: async () => "user-123",
    resolveActiveTeamCapabilities: async () => ({
      ok: true,
      teamId: TEAM_ID,
      capabilities: new Set(["*"]),
    }),
    getGithubToken: async () => "identity-token",
    appConfigured: () => true,
    resolveCreateCredential: appCredential,
    loadAppCreateTarget: async (_userId, _token, ownerLogin) => ({
      target:
        ownerLogin === "acme"
          ? {
              login: "acme",
              kind: "org",
              github_installation_id: 42,
              scope_label: "Org",
              source: "installation",
            }
          : ownerLogin === "alex"
            ? {
                login: "alex",
                kind: "personal",
                github_installation_id: null,
                scope_label: "Personal",
                source: "oauth",
              }
            : null,
      oauthScopes: ["read:org", "read:user", "user:email"],
    }),
    ...overrides,
    createGithubRepo: async (token, input) => {
      tokens.push(token);
      if (refuseCreate) {
        throw new GithubRepoCreateError(
          403,
          '{"message":"Resource not accessible by integration"}'
        );
      }
      return {
        id: 123,
        full_name: `${input.owner}/${input.name}`,
        default_branch: "main",
        owner: { login: input.owner ?? "alex" },
        name: input.name,
      };
    },
    upsertGithubReposForUser: async () => {},
    loadRepoByGithubId: async () => ({ id: "repo-123" }),
  });
}

function createRequest(ownerLogin: string) {
  return new Request("http://localhost/api/github/repos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner_login: ownerLogin, name: "widgets" }),
  });
}

test("POST /api/github/repos creates an org repo with the installation token in an App deployment", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const tokens: string[] = [];
  const response = await appModeHandler(
    createGithubRepoPostHandler,
    tokens
  )(createRequest("acme"));
  assert.equal(response.status, 200);
  assert.deepEqual(tokens, ["installation-42"]);
});

test("POST /api/github/repos explains an installation that lacks the Repository creation permission", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const tokens: string[] = [];
  const response = await appModeHandler(
    createGithubRepoPostHandler,
    tokens,
    true
  )(createRequest("acme"));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, "GITHUB_APP_PERMISSION_REQUIRED");
  assert.doesNotMatch(body.error, /Resource not accessible/);
  assert.deepEqual(tokens, ["installation-42"]);
});

test("POST /api/github/repos refuses a personal repo in an App deployment", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const tokens: string[] = [];
  const response = await appModeHandler(
    createGithubRepoPostHandler,
    tokens
  )(createRequest("alex"));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "GITHUB_APP_USER_UNAVAILABLE");
  assert.deepEqual(tokens, []);
});

test("POST /api/github/repos reports a GitHub outage during owner lookup as retryable in an App deployment", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const tokens: string[] = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await appModeHandler(
      createGithubRepoPostHandler,
      tokens,
      false,
      {
        loadAppCreateTarget: async () => {
          throw new Error("GitHub owner lookup failed (503): unavailable");
        },
      }
    )(createRequest("acme"));
    assert.equal(response.status, 502);
    assert.deepEqual(tokens, []);
  } finally {
    console.error = originalError;
  }
});

test("POST /api/github/repos refuses a blank owner_login instead of choosing the personal account", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const tokens: string[] = [];
  const response = await appModeHandler(
    createGithubRepoPostHandler,
    tokens
  )(createRequest("  "));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Choose a GitHub account for the repository",
  });
  assert.deepEqual(tokens, []);
});

test("POST /api/github/repos sends the reconnect header when the identity grant was revoked", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const tokens: string[] = [];
  const response = await appModeHandler(
    createGithubRepoPostHandler,
    tokens,
    false,
    {
      resolveCreateCredential: async () => ({
        ok: false,
        status: 400,
        code: "GITHUB_REAUTHORIZE_REQUIRED",
        error: "Reconnect GitHub to continue.",
        reauthorizeScope: "read:org",
      }),
    }
  )(createRequest("acme"));
  assert.equal(response.status, 400);
  assert.equal(
    response.headers.get("x-mogplex-github-reauthorize"),
    "read:org"
  );
  assert.deepEqual(tokens, []);
});

test("POST /api/github/repos asks to reconnect when GitHub rejects the identity grant", async () => {
  const { createGithubRepoPostHandler } = await loadRoute();
  const { GithubHttpError } = await import("../../lib/github-app");
  const tokens: string[] = [];
  const response = await appModeHandler(
    createGithubRepoPostHandler,
    tokens,
    false,
    {
      loadAppCreateTarget: async () => {
        throw new GithubHttpError(401, '{"message":"Bad credentials"}');
      },
    }
  )(createRequest("acme"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "GITHUB_REAUTHORIZE_REQUIRED");
  assert.equal(
    response.headers.get("x-mogplex-github-reauthorize"),
    "read:org"
  );
  assert.deepEqual(tokens, []);
});
