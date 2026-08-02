import assert from "node:assert/strict";
import test from "node:test";

async function loadTargetResolution() {
  return import("../../lib/vercel/target-resolution");
}

test("resolveBillingLinkedProjectSelection prefers repo-linked targets over workspace defaults", async () => {
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
      billingMode: "user_vercel_project",
      source: "repo",
      projectId: "repo-project",
      teamId: "team-repo",
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

test("resolveBillingLinkedProjectSelection falls back to account default when repo and workspace have no project", async () => {
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
      billingMode: "user_vercel_project",
      source: "account",
      projectId: "account-project",
      teamId: "account-team",
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

test("resolveEnvSyncLinkedProjectSelection only uses repo-linked projects for Vercel env sync", async () => {
  const { resolveEnvSyncLinkedProjectSelection } = await loadTargetResolution();

  assert.deepEqual(
    resolveEnvSyncLinkedProjectSelection({
      envSyncModeInput: "vercel-project",
      repoLinkedProjectId: "repo-project",
      repoLinkedTeamId: "team-repo",
    }),
    {
      envSyncMode: "vercel-project",
      source: "repo",
      projectId: "repo-project",
      teamId: "team-repo",
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

test("resolveRepoEnvVarAccess returns NO_LINKED_PROJECT for vercel-project sync without a repo-linked project", async () => {
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
      status: 400,
      error: "NO_LINKED_PROJECT",
      message:
        "Link a repo-linked Vercel project to sync env vars from Vercel.",
    }
  );
});

test("resolveRepoEnvVarAccess uses personal auth for user-billed linked projects", async () => {
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
      ok: true,
      authMode: "personal",
      projectId: "workspace-project",
      teamId: "team-workspace",
      selectionSource: "workspace",
      reason: "billing",
      vercelToken: "user-token",
    }
  );
});

test("resolveRepoEnvVarAccess uses the account-default project when repo and workspace have no linked project", async () => {
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
      ok: true,
      authMode: "personal",
      projectId: "account-project",
      teamId: "account-team",
      selectionSource: "account",
      reason: "billing",
      vercelToken: "user-token",
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
      status: 400,
      error: "NO_LINKED_PROJECT",
      message:
        "Select or create a repo-linked or workspace-linked Vercel project, then link Personal Vercel to manage env vars. Platform-backed env var management is disabled.",
    }
  );
});
