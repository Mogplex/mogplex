import assert from "node:assert/strict";
import test from "node:test";

async function loadRepoEnvVarsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.VERCEL_PROJECT_ID ||= "prj_test0000000000000000000000";
  return import("../../app/api/repos/[id]/env-vars/route");
}

test("GET /api/repos/[id]/env-vars clearly rejects disabled project env import", async () => {
  const { createRepoEnvVarsGetHandler } = await loadRepoEnvVarsRoute();
  const calls: Array<Record<string, unknown>> = [];

  const handler = createRepoEnvVarsGetHandler({
    requireUserId: async () => "user-123",
    loadRepoWithVercel: async () => ({
      id: "repo-1",
      user_id: "user-123",
      env_sync_mode: "vercel-project",
      vercel_team_id: "team-acme",
      vercel_project_id: "repo-project",
      sandbox_billing_mode_override: null,
      workspace: null,
    }),
    loadUserVercelCredentials: async () => ({
      userVercelToken: "user-token",
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
    listVercelProjectEnvVars: async (input) => {
      calls.push(input);
      return {
        ok: true as const,
        data: [
          {
            id: "env_1",
            key: "DATABASE_URL",
            value: "postgres://db",
            target: ["preview"],
            type: "encrypted",
          },
        ],
      };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/repos/repo-1/env-vars"),
    {
      params: Promise.resolve({ id: "repo-1" }),
    }
  );

  assert.equal(response.status, 501);
  assert.deepEqual(calls, []);
  assert.deepEqual(await response.json(), {
    error: "VERCEL_INTEGRATION_REQUIRED",
    message:
      "Vercel project environment import requires an API-capable Vercel integration and is not available with Sign in with Vercel.",
  });
});

test("GET /api/repos/[id]/env-vars blocks platform-managed access even for platform-enabled users", async () => {
  const { createRepoEnvVarsGetHandler } = await loadRepoEnvVarsRoute();

  const handler = createRepoEnvVarsGetHandler({
    requireUserId: async () => "user-123",
    loadRepoWithVercel: async () => ({
      id: "repo-1",
      user_id: "user-123",
      env_sync_mode: "sandbox-only",
      vercel_team_id: null,
      vercel_project_id: null,
      sandbox_billing_mode_override: null,
      workspace: {
        sandbox_billing_mode: "platform",
        sandbox_vercel_team_id: null,
        sandbox_vercel_project_id: null,
      },
    }),
    loadUserVercelCredentials: async () => ({
      userVercelToken: null,
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
    getPlatformSandboxCredentials: () => ({
      vercelToken: "platform-token",
      vercelTeamId: null,
      vercelProjectId: "platform-project",
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/repos/repo-1/env-vars"),
    {
      params: Promise.resolve({ id: "repo-1" }),
    }
  );

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: "VERCEL_INTEGRATION_REQUIRED",
    message:
      "Vercel project environment management requires an API-capable Vercel integration and is not available with Sign in with Vercel.",
  });
});

test("GET /api/repos/[id]/env-vars ignores legacy user-billed workspace selection", async () => {
  const { createRepoEnvVarsGetHandler } = await loadRepoEnvVarsRoute();

  const handler = createRepoEnvVarsGetHandler({
    requireUserId: async () => "user-123",
    loadRepoWithVercel: async () => ({
      id: "repo-1",
      user_id: "user-123",
      env_sync_mode: "sandbox-only",
      vercel_team_id: null,
      vercel_project_id: null,
      sandbox_billing_mode_override: null,
      workspace: {
        sandbox_billing_mode: "user_vercel_project",
        sandbox_vercel_team_id: "team-acme",
        sandbox_vercel_project_id: "workspace-project",
      },
    }),
    loadUserVercelCredentials: async () => ({
      userVercelToken: null,
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/repos/repo-1/env-vars"),
    {
      params: Promise.resolve({ id: "repo-1" }),
    }
  );

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: "VERCEL_INTEGRATION_REQUIRED",
    message:
      "Vercel project environment management requires an API-capable Vercel integration and is not available with Sign in with Vercel.",
  });
});

test("GET /api/repos/[id]/env-vars requires a repo-linked project when env sync mode is vercel-project", async () => {
  const { createRepoEnvVarsGetHandler } = await loadRepoEnvVarsRoute();

  const handler = createRepoEnvVarsGetHandler({
    requireUserId: async () => "user-123",
    loadRepoWithVercel: async () => ({
      id: "repo-1",
      user_id: "user-123",
      env_sync_mode: "vercel-project",
      vercel_team_id: null,
      vercel_project_id: null,
      sandbox_billing_mode_override: null,
      workspace: {
        sandbox_billing_mode: "platform",
        sandbox_vercel_team_id: "team-acme",
        sandbox_vercel_project_id: "workspace-project",
      },
    }),
    loadUserVercelCredentials: async () => ({
      userVercelToken: "user-token",
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/repos/repo-1/env-vars"),
    {
      params: Promise.resolve({ id: "repo-1" }),
    }
  );

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: "VERCEL_INTEGRATION_REQUIRED",
    message:
      "Vercel project environment import requires an API-capable Vercel integration and is not available with Sign in with Vercel.",
  });
});

test("GET /api/repos/[id]/env-vars does not use an account default from disabled user billing", async () => {
  const { createRepoEnvVarsGetHandler } = await loadRepoEnvVarsRoute();
  const calls: Array<Record<string, unknown>> = [];

  const handler = createRepoEnvVarsGetHandler({
    requireUserId: async () => "user-123",
    loadRepoWithVercel: async () => ({
      id: "repo-1",
      user_id: "user-123",
      env_sync_mode: "sandbox-only",
      vercel_team_id: null,
      vercel_project_id: null,
      sandbox_billing_mode_override: null,
      workspace: {
        sandbox_billing_mode: "user_vercel_project",
        sandbox_vercel_team_id: null,
        sandbox_vercel_project_id: null,
      },
    }),
    loadUserVercelCredentials: async () => ({
      userVercelToken: "user-token",
      userVercelTeamId: null,
      accountDefaultVercelProjectId: "account-project",
      accountDefaultVercelTeamId: "account-team",
    }),
    listVercelProjectEnvVars: async (input) => {
      calls.push(input);
      return { ok: true as const, data: [] };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/repos/repo-1/env-vars"),
    {
      params: Promise.resolve({ id: "repo-1" }),
    }
  );

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: "VERCEL_INTEGRATION_REQUIRED",
    message:
      "Vercel project environment management requires an API-capable Vercel integration and is not available with Sign in with Vercel.",
  });
  assert.deepEqual(calls, []);
});

test("GET /api/repos/[id]/env-vars blocks platform-managed access for users without platform sandbox access", async () => {
  const { createRepoEnvVarsGetHandler } = await loadRepoEnvVarsRoute();

  const handler = createRepoEnvVarsGetHandler({
    requireUserId: async () => "user-123",
    loadRepoWithVercel: async () => ({
      id: "repo-1",
      user_id: "user-123",
      env_sync_mode: "sandbox-only",
      vercel_team_id: null,
      vercel_project_id: null,
      sandbox_billing_mode_override: null,
      workspace: {
        sandbox_billing_mode: "platform",
        sandbox_vercel_team_id: null,
        sandbox_vercel_project_id: null,
      },
    }),
    loadUserVercelCredentials: async () => ({
      userVercelToken: null,
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
    getPlatformSandboxCredentials: () => ({
      vercelToken: "platform-token",
      vercelTeamId: null,
      vercelProjectId: "platform-project",
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/repos/repo-1/env-vars"),
    {
      params: Promise.resolve({ id: "repo-1" }),
    }
  );

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: "VERCEL_INTEGRATION_REQUIRED",
    message:
      "Vercel project environment management requires an API-capable Vercel integration and is not available with Sign in with Vercel.",
  });
});
