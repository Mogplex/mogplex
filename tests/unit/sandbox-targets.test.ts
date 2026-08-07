import assert from "node:assert/strict";
import test from "node:test";
import {
  loadSandboxCredentials,
  loadSandboxBilling,
  buildPlatformCredentials,
  buildUserCredentials,
  buildPlatformTarget,
  buildUserTarget,
  buildPlatformRecord,
  buildUserRecord,
} from "./helpers/sandbox-targets-fixtures";

test("resolveSandboxTarget ignores a legacy repo user-billing selection", async () => {
  const { resolveSandboxTarget } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTarget({
      workspaceBillingModeInput: "platform",
      repoBillingModeOverrideInput: "user_vercel_project",
      repoLinkedProjectId: "prj_linked",
      repoLinkedTeamId: "team_linked",
    }),
    buildPlatformTarget()
  );
});

test("resolveSandboxTarget cannot activate user billing through a stale setting", async () => {
  const { resolveSandboxTarget } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTarget({
      workspaceBillingModeInput: "platform",
      repoBillingModeOverrideInput: "user_vercel_project",
    }),
    buildPlatformTarget()
  );
});

test("resolveSandboxTargetCredentials chooses user credentials for linked targets", async () => {
  const { resolveSandboxTargetCredentials } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTargetCredentials(
      buildUserCredentials(),
      buildUserTarget("linked-project", "linked-team")
    ),
    {
      ok: true,
      vercelToken: "user-token",
      vercelTeamId: "linked-team",
      vercelProjectId: "linked-project",
    }
  );
});

test("resolveSandboxTargetCredentials keeps personal user-owned projects out of team scope", async () => {
  const { resolveSandboxTargetCredentials } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTargetCredentials(
      buildUserCredentials({ userVercelTeamId: "workspace-team" }),
      buildUserTarget("personal-project", null)
    ),
    {
      ok: true,
      vercelToken: "user-token",
      vercelTeamId: null,
      vercelProjectId: "personal-project",
    }
  );
});

test("resolveSandboxRecordCredentials falls back to user-linked project context", async () => {
  const { resolveSandboxRecordCredentials } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxRecordCredentials(
      buildUserCredentials(),
      buildUserRecord("linked-project", "linked-team")
    ),
    {
      ok: true,
      vercelToken: "user-token",
      vercelTeamId: "linked-team",
      vercelProjectId: "linked-project",
    }
  );
});

test("resolveSandboxRecordCredentials refreshes platform-owned targets from current platform credentials", async () => {
  const { resolveSandboxRecordCredentials } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxRecordCredentials(
      buildPlatformCredentials({
        vercelTeamId: "current-platform-team",
        vercelProjectId: "current-platform-project",
      }),
      buildPlatformRecord({
        billing_project_id: "stale-platform-project",
        billing_team_id: "stale-platform-team",
        vercel_project_id: "stale-platform-project",
        vercel_team_id: "stale-platform-team",
      })
    ),
    {
      ok: true,
      vercelToken: "platform-token",
      vercelTeamId: "current-platform-team",
      vercelProjectId: "current-platform-project",
    }
  );
});

test("resolveSandboxRecordCredentials fails closed for user-billed sandboxes missing a stored project", async () => {
  const { resolveSandboxRecordCredentials } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxRecordCredentials(
      buildUserCredentials(),
      buildUserRecord(null as never, null)
    ),
    {
      ok: false,
      error:
        "Sandbox is missing its stored Vercel project for user-owned billing.",
      status: 400,
    }
  );
});

test("resolveSandboxTarget does not activate user billing from an account default", async () => {
  const { resolveSandboxTarget } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTarget({
      workspaceBillingModeInput: "user_vercel_project",
      repoBillingModeOverrideInput: null,
      accountLinkedProjectId: "prj_account",
      accountLinkedTeamId: "team_account",
    }),
    buildPlatformTarget()
  );
});

test("resolveSandboxTarget ignores legacy workspace and account billing targets", async () => {
  const { resolveSandboxTarget } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTarget({
      workspaceBillingModeInput: "user_vercel_project",
      workspaceLinkedProjectId: "prj_workspace",
      workspaceLinkedTeamId: "team_workspace",
      accountLinkedProjectId: "prj_account",
      accountLinkedTeamId: "team_account",
    }),
    buildPlatformTarget()
  );
});

test("resolveSandboxTarget keeps inherited legacy user billing on platform", async () => {
  const { resolveSandboxTarget } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTarget({
      workspaceBillingModeInput: "user_vercel_project",
      repoBillingModeOverrideInput: null,
      workspaceLinkedProjectId: "prj_workspace",
      workspaceLinkedTeamId: "team_workspace",
    }),
    buildPlatformTarget()
  );
});

test("resolveRepoSandboxTeamSelection exposes inherited workspace team explicitly", async () => {
  const { INHERITED_WORKSPACE_TEAM_OPTION, resolveRepoSandboxTeamSelection } =
    await loadSandboxBilling();

  assert.deepEqual(
    resolveRepoSandboxTeamSelection({
      effectiveBillingMode: "user_vercel_project",
      repoLinkedTeamId: null,
      workspaceLinkedTeamId: "team_workspace",
      workspaceLinkedProjectId: "prj_workspace",
    }),
    {
      selectedTeamValue: INHERITED_WORKSPACE_TEAM_OPTION,
      teamScope: "team_workspace",
      usingWorkspaceTeam: true,
    }
  );
});

test("resolveRepoLinkedTeamPersistence pins the inherited workspace team when a repo-specific project is selected", async () => {
  const { resolveRepoLinkedTeamPersistence } = await loadSandboxBilling();

  assert.equal(
    resolveRepoLinkedTeamPersistence({
      repoLinkedTeamId: null,
      repoLinkedProjectId: "prj_repo",
      workspaceLinkedTeamId: "team_workspace",
      usingWorkspaceTeam: true,
    }),
    "team_workspace"
  );
});

test("resolveSandboxTargetCredentials blocks platform billing for non-allowlisted users", async () => {
  const { resolveSandboxTargetCredentials } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTargetCredentials(
      buildPlatformCredentials({ allowPlatformSandbox: false }),
      buildPlatformTarget()
    ),
    {
      ok: false,
      error:
        "Hosted sandbox compute requires a positive billing balance. Add funds or choose a plan in Settings > Billing.",
      status: 403,
    }
  );
});

test("resolveSandboxRecordCredentials blocks existing platform sandboxes for non-allowlisted users", async () => {
  const { resolveSandboxRecordCredentials } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxRecordCredentials(
      buildPlatformCredentials({ allowPlatformSandbox: false }),
      buildPlatformRecord()
    ),
    {
      ok: false,
      error:
        "Hosted sandbox compute requires a positive billing balance. Add funds or choose a plan in Settings > Billing.",
      status: 403,
    }
  );
});

test("getPlatformSandboxCredentials returns a null project ID instead of throwing when VERCEL_PROJECT_ID is unset", async () => {
  const { getPlatformSandboxCredentials } = await loadSandboxCredentials();
  const savedVercelProjectId = process.env.VERCEL_PROJECT_ID;
  const savedPlatformProjectId = process.env.PLATFORM_VERCEL_PROJECT_ID;
  delete process.env.VERCEL_PROJECT_ID;
  delete process.env.PLATFORM_VERCEL_PROJECT_ID;
  try {
    assert.equal(getPlatformSandboxCredentials().vercelProjectId, null);
  } finally {
    if (savedVercelProjectId !== undefined)
      process.env.VERCEL_PROJECT_ID = savedVercelProjectId;
    if (savedPlatformProjectId !== undefined)
      process.env.PLATFORM_VERCEL_PROJECT_ID = savedPlatformProjectId;
  }
});

test("getPlatformSandboxCredentials supports the platform project ID alias", async () => {
  const { getPlatformSandboxCredentials } = await loadSandboxCredentials();
  const savedVercelProjectId = process.env.VERCEL_PROJECT_ID;
  const savedPlatformProjectId = process.env.PLATFORM_VERCEL_PROJECT_ID;
  delete process.env.VERCEL_PROJECT_ID;
  process.env.PLATFORM_VERCEL_PROJECT_ID = "platform-project";
  try {
    assert.equal(
      getPlatformSandboxCredentials().vercelProjectId,
      "platform-project"
    );
  } finally {
    if (savedVercelProjectId !== undefined)
      process.env.VERCEL_PROJECT_ID = savedVercelProjectId;
    if (savedPlatformProjectId === undefined)
      delete process.env.PLATFORM_VERCEL_PROJECT_ID;
    else process.env.PLATFORM_VERCEL_PROJECT_ID = savedPlatformProjectId;
  }
});

test("VERCEL_PROJECT_ID takes precedence over the platform alias", async () => {
  const { getPlatformSandboxCredentials } = await loadSandboxCredentials();
  const savedVercelProjectId = process.env.VERCEL_PROJECT_ID;
  const savedPlatformProjectId = process.env.PLATFORM_VERCEL_PROJECT_ID;
  process.env.VERCEL_PROJECT_ID = "canonical-project";
  process.env.PLATFORM_VERCEL_PROJECT_ID = "alias-project";
  try {
    assert.equal(
      getPlatformSandboxCredentials().vercelProjectId,
      "canonical-project"
    );
  } finally {
    if (savedVercelProjectId === undefined)
      delete process.env.VERCEL_PROJECT_ID;
    else process.env.VERCEL_PROJECT_ID = savedVercelProjectId;
    if (savedPlatformProjectId === undefined)
      delete process.env.PLATFORM_VERCEL_PROJECT_ID;
    else process.env.PLATFORM_VERCEL_PROJECT_ID = savedPlatformProjectId;
  }
});

test("resolveSandboxTargetCredentials rejects platform targets with a structured error when the platform project is not configured", async () => {
  const {
    resolveSandboxTargetCredentials,
    PLATFORM_VERCEL_PROJECT_NOT_CONFIGURED_ERROR,
  } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTargetCredentials(
      buildPlatformCredentials({ vercelProjectId: null }),
      buildPlatformTarget()
    ),
    {
      ok: false,
      error: PLATFORM_VERCEL_PROJECT_NOT_CONFIGURED_ERROR,
      status: 500,
    }
  );
});

test("resolveSandboxTargetCredentials still resolves user-billed targets when the platform project is not configured", async () => {
  const { resolveSandboxTargetCredentials } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTargetCredentials(
      {
        vercelToken: null,
        vercelTeamId: null,
        vercelProjectId: null,
        allowPlatformSandbox: false,
        userVercelToken: "user-token",
        userVercelTeamId: "user-team",
      },
      buildUserTarget("prj_linked", "team_linked")
    ),
    {
      ok: true,
      vercelToken: "user-token",
      vercelTeamId: "team_linked",
      vercelProjectId: "prj_linked",
    }
  );
});

test("resolveSandboxRecordCredentials rejects platform records with a structured error when no project ID is stored or configured", async () => {
  const {
    resolveSandboxRecordCredentials,
    PLATFORM_VERCEL_PROJECT_NOT_CONFIGURED_ERROR,
  } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxRecordCredentials(
      buildPlatformCredentials({ vercelProjectId: null }),
      buildPlatformRecord({ billing_project_id: null, vercel_project_id: null })
    ),
    {
      ok: false,
      error: PLATFORM_VERCEL_PROJECT_NOT_CONFIGURED_ERROR,
      status: 500,
    }
  );
});
