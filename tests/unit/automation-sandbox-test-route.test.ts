import assert from "node:assert/strict";
import test from "node:test";
import type { Repo } from "../../lib/types";

async function loadRouteModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/automations/sandbox-test/route");
}

function buildRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: "repo-1",
    user_id: "user-1",
    full_name: "acme/widgets",
    github_installation_id: 123,
    default_branch: "main",
    sandbox_billing_mode_override: "platform",
    sandbox_env_vars: { DATABASE_URL: "postgres://example" },
    env_sync_mode: "sandbox-only",
    dev_port: 3000,
    dev_port_auto: true,
    created_at: "2026-06-22T12:00:00.000Z",
    ...overrides,
  };
}

test("POST /api/automations/sandbox-test reports sandbox env readiness", async () => {
  const { createAutomationSandboxTestPostHandler } = await loadRouteModule();
  const handler = createAutomationSandboxTestPostHandler({
    requireUserId: async () => "user-1",
    getRepoForScope: async () => buildRepo(),
    getSandboxServiceCredentials: async () => ({
      userId: "user-1",
      vercelToken: "platform-token",
      vercelTeamId: "team-1",
      vercelProjectId: "project-1",
      allowPlatformSandbox: true,
      userVercelToken: null,
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
    resolveRepoSandboxEnv: async () => ({
      envVars: { DATABASE_URL: "postgres://example" },
      sync: {
        mode: "sandbox-only",
        source: "manual",
        warning: null,
      },
    }),
  });

  const response = await handler(
    new Request("https://mogplex.test/api/automations/sandbox-test", {
      method: "POST",
      body: JSON.stringify({ repoId: "repo-1" }),
    })
  );
  const payload = (await response.json()) as {
    ok: boolean;
    env: { configured: boolean; count: number; source: string };
    sandbox: { credentialSource: string };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.env.configured, true);
  assert.equal(payload.env.count, 1);
  assert.equal(payload.env.source, "manual");
  assert.equal(payload.sandbox.credentialSource, "platform");
});

test("POST /api/automations/sandbox-test fails readiness without GitHub App coverage", async () => {
  const { createAutomationSandboxTestPostHandler } = await loadRouteModule();
  const handler = createAutomationSandboxTestPostHandler({
    requireUserId: async () => "user-1",
    getRepoForScope: async () => buildRepo({ github_installation_id: null }),
    getSandboxServiceCredentials: async () => ({
      userId: "user-1",
      vercelToken: "platform-token",
      vercelTeamId: "team-1",
      vercelProjectId: "project-1",
      allowPlatformSandbox: true,
      userVercelToken: null,
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
    resolveRepoSandboxEnv: async () => ({
      envVars: { DATABASE_URL: "postgres://example" },
      sync: {
        mode: "sandbox-only",
        source: "manual",
        warning: null,
      },
    }),
  });

  const response = await handler(
    new Request("https://mogplex.test/api/automations/sandbox-test", {
      method: "POST",
      body: JSON.stringify({ repoId: "repo-1" }),
    })
  );
  const payload = (await response.json()) as {
    ok: boolean;
    error: string;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /GitHub App installation is required/);
});
