import assert from "node:assert/strict";
import test from "node:test";

async function loadGithubInstallationsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/github/installations/route");
}

function createCookieStore() {
  return {
    get: () => {},
    set: () => {},
    delete: () => {},
  };
}

test("GET /api/github/installations returns org-scoped manage URLs", async () => {
  const { createGithubInstallationsGetHandler } =
    await loadGithubInstallationsRoute();

  const handler = createGithubInstallationsGetHandler({
    getCookies: async () => createCookieStore() as never,
    requireUserId: async () => "user-123",
    hasGithubAppConfig: () => false,
    loadInstallations: async () => ({
      data: [
        {
          id: "row-1",
          installation_id: 42,
          account_login: "acme",
          account_type: "Organization",
          target_type: "Organization",
        },
      ],
      error: null,
    }),
    loadRepos: async () => ({ data: [], error: null }),
    loadProfile: async () => ({
      data: { github_username: "octocat" },
      error: null,
    }),
    getOAuthToken: async () => null,
    reconcileGithubInstallationsForUser: async () => ({ discovered: 0 }),
    getGithubInstallation: async () => {
      throw new Error("getGithubInstallation should not be called");
    },
    updateInstallationMetadata: async () => ({ error: null }),
  });

  const response = await handler();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    {
      id: "row-1",
      installation_id: 42,
      account_login: "acme",
      account_type: "Organization",
      target_type: "Organization",
      repositories: [],
      repository_count: 0,
      synced_repo_count: 0,
      scope_label: "Org",
      manage_url:
        "https://github.com/organizations/acme/settings/installations/42",
    },
  ]);
});

test("GET /api/github/installations returns personal manage URLs for user installs", async () => {
  const { createGithubInstallationsGetHandler } =
    await loadGithubInstallationsRoute();

  const handler = createGithubInstallationsGetHandler({
    getCookies: async () => createCookieStore() as never,
    requireUserId: async () => "user-123",
    hasGithubAppConfig: () => false,
    loadInstallations: async () => ({
      data: [
        {
          id: "row-1",
          installation_id: 7,
          account_login: "alex",
          account_type: "User",
          target_type: "User",
        },
      ],
      error: null,
    }),
    loadRepos: async () => ({ data: [], error: null }),
    loadProfile: async () => ({
      data: { github_username: "alex" },
      error: null,
    }),
    getOAuthToken: async () => null,
    reconcileGithubInstallationsForUser: async () => ({ discovered: 0 }),
    getGithubInstallation: async () => {
      throw new Error("getGithubInstallation should not be called");
    },
    updateInstallationMetadata: async () => ({ error: null }),
  });

  const response = await handler();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    {
      id: "row-1",
      installation_id: 7,
      account_login: "alex",
      account_type: "User",
      target_type: "User",
      repositories: [],
      repository_count: 0,
      synced_repo_count: 0,
      scope_label: "User",
      manage_url: "https://github.com/settings/installations/7",
    },
  ]);
});

test("GET /api/github/installations refreshes incomplete metadata before building the manage URL", async () => {
  const { createGithubInstallationsGetHandler } =
    await loadGithubInstallationsRoute();
  const updates: Array<{ rowId: string; updates: Record<string, unknown> }> =
    [];

  const handler = createGithubInstallationsGetHandler({
    getCookies: async () => createCookieStore() as never,
    requireUserId: async () => "user-123",
    hasGithubAppConfig: () => false,
    loadInstallations: async () => ({
      data: [
        {
          id: "row-1",
          installation_id: 91,
          account_login: "acme",
          account_type: null,
          target_type: null,
        },
      ],
      error: null,
    }),
    loadRepos: async () => ({ data: [], error: null }),
    loadProfile: async () => ({
      data: { github_username: "octocat" },
      error: null,
    }),
    getOAuthToken: async () => null,
    reconcileGithubInstallationsForUser: async () => ({ discovered: 0 }),
    getGithubInstallation: async () => ({
      id: 91,
      account: { login: "acme", type: "Organization" },
      target_type: "Organization",
      permissions: { contents: "write" },
    }),
    updateInstallationMetadata: async (rowId, routeUpdates) => {
      updates.push({ rowId, updates: routeUpdates });
      return { error: null };
    },
  });

  const response = await handler();

  assert.equal(response.status, 200);
  assert.deepEqual(updates, [
    {
      rowId: "row-1",
      updates: {
        account_login: "acme",
        account_type: "Organization",
        target_type: "Organization",
        permissions: { contents: "write" },
      },
    },
  ]);
  assert.deepEqual(await response.json(), [
    {
      id: "row-1",
      installation_id: 91,
      account_login: "acme",
      account_type: "Organization",
      target_type: "Organization",
      repositories: [],
      repository_count: 0,
      synced_repo_count: 0,
      scope_label: "Org",
      manage_url:
        "https://github.com/organizations/acme/settings/installations/91",
    },
  ]);
});

test("GET /api/github/installations omits manage_url when incomplete metadata cannot be refreshed", async () => {
  const { createGithubInstallationsGetHandler } =
    await loadGithubInstallationsRoute();

  const handler = createGithubInstallationsGetHandler({
    getCookies: async () => createCookieStore() as never,
    requireUserId: async () => "user-123",
    hasGithubAppConfig: () => false,
    loadInstallations: async () => ({
      data: [
        {
          id: "row-1",
          installation_id: 117860437,
          account_login: "acme",
          account_type: null,
          target_type: null,
        },
      ],
      error: null,
    }),
    loadRepos: async () => ({ data: [], error: null }),
    loadProfile: async () => ({
      data: { github_username: "octocat" },
      error: null,
    }),
    getOAuthToken: async () => null,
    reconcileGithubInstallationsForUser: async () => ({ discovered: 0 }),
    getGithubInstallation: async () => {
      throw new Error("not found");
    },
    updateInstallationMetadata: async () => ({ error: null }),
  });

  const response = await handler();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    {
      id: "row-1",
      installation_id: 117860437,
      account_login: "acme",
      account_type: null,
      target_type: null,
      repositories: [],
      repository_count: 0,
      synced_repo_count: 0,
      scope_label: "Account",
      manage_url: null,
    },
  ]);
});

test("GET /api/github/installations discovers new org installations beside existing ones, once per skip window", async () => {
  const { createGithubInstallationsGetHandler } =
    await loadGithubInstallationsRoute();
  const cookies = new Map<string, string>();
  const reconcileCalls: string[] = [];
  const existing = {
    id: "row-1",
    installation_id: 42,
    account_login: "acme",
    account_type: "Organization",
    target_type: "Organization",
  };
  const handler = createGithubInstallationsGetHandler({
    getCookies: async () =>
      ({
        get: (name: string) =>
          cookies.has(name) ? { value: cookies.get(name) } : undefined,
        set: (name: string, value: string) => cookies.set(name, value),
        delete: (name: string) => cookies.delete(name),
      }) as never,
    requireUserId: async () => "user-123",
    hasGithubAppConfig: () => true,
    loadInstallations: async () => ({
      data:
        reconcileCalls.length > 0
          ? [
              existing,
              {
                ...existing,
                id: "row-2",
                installation_id: 43,
                account_login: "new-org",
              },
            ]
          : [existing],
      error: null,
    }),
    loadRepos: async () => ({ data: [], error: null }),
    loadProfile: async () => ({
      data: { github_username: "octocat" },
      error: null,
    }),
    getOAuthToken: async () => "identity-fixture",
    reconcileGithubInstallationsForUser: async (userId) => {
      reconcileCalls.push(userId);
      return { discovered: 1 };
    },
    getGithubInstallation: async () => {
      throw new Error("getGithubInstallation should not be called");
    },
    updateInstallationMetadata: async () => ({ error: null }),
  });

  const first = await handler();
  const body = (await first.json()) as Array<{ account_login: string }>;
  assert.deepEqual(
    body.map((installation) => installation.account_login),
    ["acme", "new-org"]
  );
  assert.equal(cookies.get("github_reconcile_skip"), "1");

  await handler();
  assert.deepEqual(reconcileCalls, ["user-123"]);
});
