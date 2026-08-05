import assert from "node:assert/strict";
import test from "node:test";

async function loadSandboxContext() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/context");
}

test("resolveSandboxCreateContext returns durable ownership, credentials, and AI context", async () => {
  const { resolveSandboxCreateContext } = await loadSandboxContext();

  const resolved = await resolveSandboxCreateContext(
    {
      sandboxCredentials: {
        userId: "user-123",
        vercelToken: "platform-token",
        vercelTeamId: "platform-team",
        vercelProjectId: "platform-project",
        userVercelToken: "user-token",
        userVercelTeamId: "user-team",
        accountDefaultVercelProjectId: null,
        accountDefaultVercelTeamId: null,
      },
      workspaceBillingModeInput: "platform",
      repoBillingModeOverrideInput: "user_vercel_project",
      repoLinkedProjectId: "repo-project",
      repoLinkedTeamId: "repo-team",
      includeAi: true,
    },
    {
      resolveSandboxAiAccess: async () => ({
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: "gateway-key",
        platformAccessRestricted: false,
        providerKeys: {
          anthropic: null,
          openai: null,
        },
      }),
    }
  );

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  assert.deepEqual(resolved.context.ownership, {
    source: "config",
    billingSource: "platform",
    credentialSource: "platform",
    projectId: "platform-project",
    teamId: "platform-team",
  });
  assert.deepEqual(resolved.context.credentials, {
    vercelToken: "platform-token",
    vercelTeamId: "platform-team",
    vercelProjectId: "platform-project",
  });
  assert.ok("ai" in resolved.context);
  if (!("ai" in resolved.context)) return;
  assert.equal(resolved.context.ai.aiBillingSource, "user_ai_gateway");
  assert.equal(resolved.context.ai.terminalEnv.OPENAI_API_KEY, "gateway-key");
  assert.equal(
    resolved.context.ai.terminalShellEnv.ANTHROPIC_AUTH_TOKEN,
    "gateway-key"
  );
});

test("resolveSandboxRecordContext resolves stored record ownership without AI when not requested", async () => {
  const { resolveSandboxRecordContext } = await loadSandboxContext();

  const resolved = await resolveSandboxRecordContext({
    sandboxCredentials: {
      vercelToken: "platform-token",
      vercelTeamId: "platform-team",
      vercelProjectId: "platform-project",
      userVercelToken: "user-token",
      userVercelTeamId: "user-team",
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    },
    record: {
      billing_source: "user_vercel_project",
      billing_project_id: "sandbox-project",
      billing_team_id: "sandbox-team",
      vercel_project_id: "sandbox-project",
      vercel_team_id: "sandbox-team",
    },
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  assert.deepEqual(resolved.context.ownership, {
    source: "record",
    billingSource: "user_vercel_project",
    credentialSource: "user",
    projectId: "sandbox-project",
    teamId: "sandbox-team",
  });
  assert.equal("ai" in resolved.context, false);
});

test("resolveSnapshotContext prefers stored snapshot ownership over mutable repo settings", async () => {
  const { resolveSnapshotContext } = await loadSandboxContext();

  const resolved = await resolveSnapshotContext({
    sandboxCredentials: {
      userId: "user-123",
      vercelToken: "platform-token",
      vercelTeamId: "platform-team",
      vercelProjectId: "platform-project",
      userVercelToken: "user-token",
      userVercelTeamId: "user-team",
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    },
    repo: {
      snapshot_billing_source: "user_vercel_project",
      snapshot_billing_project_id: "snapshot-project",
      snapshot_billing_team_id: "snapshot-team",
      sandbox_billing_mode_override: "platform",
      vercel_project_id: "repo-project",
      vercel_team_id: "repo-team",
      workspace: {
        sandbox_billing_mode: "platform",
        sandbox_vercel_project_id: null,
        sandbox_vercel_team_id: null,
      },
    },
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  assert.deepEqual(resolved.context.credentials, {
    vercelToken: "user-token",
    vercelTeamId: "snapshot-team",
    vercelProjectId: "snapshot-project",
  });
  assert.deepEqual(resolved.context.ownership, {
    source: "record",
    billingSource: "user_vercel_project",
    credentialSource: "user",
    projectId: "snapshot-project",
    teamId: "snapshot-team",
  });
});

test("resolveSnapshotContext ignores legacy account-default user billing without stored ownership", async () => {
  const { resolveSnapshotContext } = await loadSandboxContext();

  const resolved = await resolveSnapshotContext({
    sandboxCredentials: {
      userId: "user-123",
      vercelToken: "platform-token",
      vercelTeamId: "platform-team",
      vercelProjectId: "platform-project",
      userVercelToken: "user-token",
      userVercelTeamId: "user-team",
      accountDefaultVercelProjectId: "account-project",
      accountDefaultVercelTeamId: "account-team",
    },
    repo: {
      snapshot_billing_source: null,
      snapshot_billing_project_id: null,
      snapshot_billing_team_id: null,
      sandbox_billing_mode_override: null,
      vercel_project_id: null,
      vercel_team_id: null,
      workspace: {
        sandbox_billing_mode: "user_vercel_project",
        sandbox_vercel_project_id: null,
        sandbox_vercel_team_id: null,
      },
    },
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  assert.deepEqual(resolved.context.credentials, {
    vercelToken: "platform-token",
    vercelTeamId: "platform-team",
    vercelProjectId: "platform-project",
  });
  assert.deepEqual(resolved.context.ownership, {
    source: "config",
    billingSource: "platform",
    credentialSource: "platform",
    projectId: "platform-project",
    teamId: "platform-team",
  });
});

test("resolveSandboxCreateContext blocks platform billing for users without platform sandbox access", async () => {
  const { resolveSandboxCreateContext } = await loadSandboxContext();

  const resolved = await resolveSandboxCreateContext({
    sandboxCredentials: {
      userId: "user-123",
      vercelToken: "platform-token",
      vercelTeamId: "platform-team",
      vercelProjectId: "platform-project",
      allowPlatformSandbox: false,
      userVercelToken: null,
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    },
    workspaceBillingModeInput: "platform",
    repoBillingModeOverrideInput: null,
    includeAi: false,
  });

  assert.deepEqual(resolved, {
    ok: false,
    error:
      "Hosted sandbox compute requires a positive billing balance. Add funds or choose a plan in Settings > Billing.",
    status: 403,
    billingSource: "platform",
    credentialSource: "platform",
  });
});
