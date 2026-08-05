import assert from "node:assert/strict";
import test from "node:test";

async function loadTargetResolution() {
  return import("../../lib/vercel/target-resolution");
}

test("resolveBillingLinkedProjectSelection ignores disabled user-billing targets", async () => {
  const {
    resolveBillingLinkedProjectSelection,
    resolveBillingLinkedProjectOwner,
  } = await loadTargetResolution();

  assert.deepEqual(
    resolveBillingLinkedProjectSelection({
      workspaceBillingModeInput: "user_vercel_project",
      repoBillingModeOverrideInput: "user_vercel_project",
      repoLinkedProjectId: "repo-project",
      repoLinkedTeamId: "team-repo",
      workspaceLinkedProjectId: "workspace-project",
      workspaceLinkedTeamId: "team-workspace",
    }),
    {
      billingMode: "platform",
      source: null,
      projectId: null,
      teamId: null,
    }
  );

  assert.equal(
    resolveBillingLinkedProjectOwner({
      workspaceBillingModeInput: "user_vercel_project",
      repoBillingModeOverrideInput: "user_vercel_project",
      repoLinkedProjectId: "repo-project",
    }),
    "repo"
  );
});

test("resolveBillingLinkedProjectOwner keeps repo ownership when override is enabled even before a project is selected", async () => {
  const { resolveBillingLinkedProjectOwner } = await loadTargetResolution();

  assert.equal(
    resolveBillingLinkedProjectOwner({
      workspaceBillingModeInput: "user_vercel_project",
      repoBillingModeOverrideInput: "user_vercel_project",
      repoLinkedProjectId: null,
    }),
    "repo"
  );

  assert.equal(
    resolveBillingLinkedProjectOwner({
      workspaceBillingModeInput: "user_vercel_project",
      repoBillingModeOverrideInput: null,
      repoLinkedProjectId: null,
    }),
    "workspace"
  );
});

test("resolveBillingLinkedProjectSelection ignores legacy account defaults", async () => {
  const { resolveBillingLinkedProjectSelection } = await loadTargetResolution();

  assert.deepEqual(
    resolveBillingLinkedProjectSelection({
      workspaceBillingModeInput: "user_vercel_project",
      repoBillingModeOverrideInput: null,
      repoLinkedProjectId: null,
      repoLinkedTeamId: null,
      workspaceLinkedProjectId: null,
      workspaceLinkedTeamId: null,
      accountLinkedProjectId: "account-project",
      accountLinkedTeamId: "account-team",
    }),
    {
      billingMode: "platform",
      source: null,
      projectId: null,
      teamId: null,
    }
  );
});

test("resolveBillingLinkedProjectOwner attributes to account when only account default is set", async () => {
  const { resolveBillingLinkedProjectOwner } = await loadTargetResolution();

  assert.equal(
    resolveBillingLinkedProjectOwner({
      workspaceBillingModeInput: "user_vercel_project",
      repoBillingModeOverrideInput: null,
      repoLinkedProjectId: null,
      workspaceLinkedProjectId: null,
      accountLinkedProjectId: "account-project",
    }),
    "account"
  );

  assert.equal(
    resolveBillingLinkedProjectOwner({
      workspaceBillingModeInput: "user_vercel_project",
      repoBillingModeOverrideInput: null,
      repoLinkedProjectId: null,
      workspaceLinkedProjectId: "workspace-project",
      accountLinkedProjectId: "account-project",
    }),
    "workspace"
  );
});

test("resolveEnvSyncLinkedProjectSelection normalizes disabled Vercel import", async () => {
  const { resolveEnvSyncLinkedProjectSelection } = await loadTargetResolution();

  assert.deepEqual(
    resolveEnvSyncLinkedProjectSelection({
      envSyncModeInput: "vercel-project",
      repoLinkedProjectId: "repo-project",
      repoLinkedTeamId: "team-repo",
    }),
    {
      envSyncMode: "sandbox-only",
      source: null,
      projectId: null,
      teamId: null,
    }
  );

  assert.deepEqual(
    resolveEnvSyncLinkedProjectSelection({
      envSyncModeInput: "sandbox-only",
      repoLinkedProjectId: "repo-project",
      repoLinkedTeamId: "team-repo",
    }),
    {
      envSyncMode: "sandbox-only",
      source: null,
      projectId: null,
      teamId: null,
    }
  );
});

test("resolveRepoEnvVarAccess clearly rejects disabled Vercel project import", async () => {
  const { resolveRepoEnvVarAccess } = await loadTargetResolution();

  assert.deepEqual(
    resolveRepoEnvVarAccess({
      envSyncModeInput: "vercel-project",
      personalVercelToken: "user-token",
      platformVercelToken: "platform-token",
      platformVercelProjectId: "platform-project",
    }),
    {
      ok: false,
      status: 501,
      error: "VERCEL_INTEGRATION_REQUIRED",
      message:
        "Vercel project environment import requires an API-capable Vercel integration and is not available with Sign in with Vercel.",
    }
  );
});

test("resolveRepoEnvVarAccess ignores legacy workspace user billing", async () => {
  const { resolveRepoEnvVarAccess } = await loadTargetResolution();

  assert.deepEqual(
    resolveRepoEnvVarAccess({
      envSyncModeInput: "sandbox-only",
      workspaceBillingModeInput: "user_vercel_project",
      workspaceLinkedProjectId: "workspace-project",
      workspaceLinkedTeamId: "team-workspace",
      personalVercelToken: "user-token",
      platformVercelToken: "platform-token",
      platformVercelProjectId: "platform-project",
    }),
    {
      ok: false,
      status: 501,
      error: "VERCEL_INTEGRATION_REQUIRED",
      message:
        "Vercel project environment management requires an API-capable Vercel integration and is not available with Sign in with Vercel.",
    }
  );
});

test("resolveRepoEnvVarAccess ignores legacy account-default user billing", async () => {
  const { resolveRepoEnvVarAccess } = await loadTargetResolution();

  assert.deepEqual(
    resolveRepoEnvVarAccess({
      envSyncModeInput: "sandbox-only",
      workspaceBillingModeInput: "user_vercel_project",
      accountLinkedProjectId: "account-project",
      accountLinkedTeamId: "account-team",
      personalVercelToken: "user-token",
      platformVercelToken: "platform-token",
      platformVercelProjectId: "platform-project",
    }),
    {
      ok: false,
      status: 501,
      error: "VERCEL_INTEGRATION_REQUIRED",
      message:
        "Vercel project environment management requires an API-capable Vercel integration and is not available with Sign in with Vercel.",
    }
  );
});

test("resolveRepoEnvVarAccess blocks platform billing from managing env vars", async () => {
  const { resolveRepoEnvVarAccess } = await loadTargetResolution();

  assert.deepEqual(
    resolveRepoEnvVarAccess({
      envSyncModeInput: "sandbox-only",
      workspaceBillingModeInput: "platform",
      personalVercelToken: null,
      platformVercelToken: "platform-token",
      platformVercelTeamId: "team-platform",
      platformVercelProjectId: "platform-project",
    }),
    {
      ok: false,
      status: 501,
      error: "VERCEL_INTEGRATION_REQUIRED",
      message:
        "Vercel project environment management requires an API-capable Vercel integration and is not available with Sign in with Vercel.",
    }
  );
});
