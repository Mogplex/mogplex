import assert from "node:assert/strict";
import test from "node:test";

async function loadSandboxCredentials() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/get-user-credentials");
}

async function loadSandboxBilling() {
  return import("../../lib/sandbox/billing");
}

test("resolveSandboxTarget uses repo-linked Vercel projects when user billing is active", async () => {
  const { resolveSandboxTarget } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTarget({
      workspaceBillingModeInput: "platform",
      repoBillingModeOverrideInput: "user_vercel_project",
      repoLinkedProjectId: "prj_linked",
      repoLinkedTeamId: "team_linked",
    }),
    {
      ok: true,
      billingSource: "user_vercel_project",
      credentialSource: "user",
      projectId: "prj_linked",
      teamId: "team_linked",
    }
  );
});

test("resolveSandboxTarget rejects user billing without a linked repo or workspace project", async () => {
  const { resolveSandboxTarget } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTarget({
      workspaceBillingModeInput: "platform",
      repoBillingModeOverrideInput: "user_vercel_project",
    }),
    {
      ok: false,
      billingSource: "user_vercel_project",
      error:
        "Select or create a Vercel project for user-owned sandbox billing.",
    }
  );
});

test("resolveSandboxTargetCredentials chooses user credentials for linked targets", async () => {
  const { resolveSandboxTargetCredentials } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTargetCredentials(
      {
        vercelToken: "platform-token",
        vercelTeamId: "platform-team",
        vercelProjectId: "platform-project",
        allowPlatformSandbox: true,
        userVercelToken: "user-token",
        userVercelTeamId: "user-team",
      },
      {
        ok: true,
        billingSource: "user_vercel_project",
        credentialSource: "user",
        teamId: "linked-team",
        projectId: "linked-project",
      }
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
      {
        vercelToken: "platform-token",
        vercelTeamId: "platform-team",
        vercelProjectId: "platform-project",
        allowPlatformSandbox: true,
        userVercelToken: "user-token",
        userVercelTeamId: "workspace-team",
      },
      {
        ok: true,
        billingSource: "user_vercel_project",
        credentialSource: "user",
        teamId: null,
        projectId: "personal-project",
      }
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
      {
        vercelToken: "platform-token",
        vercelTeamId: "platform-team",
        vercelProjectId: "platform-project",
        allowPlatformSandbox: true,
        userVercelToken: "user-token",
        userVercelTeamId: "user-team",
      },
      {
        billing_source: "user_vercel_project",
        billing_project_id: "linked-project",
        billing_team_id: "linked-team",
        vercel_project_id: "linked-project",
        vercel_team_id: "linked-team",
      }
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
      {
        vercelToken: "platform-token",
        vercelTeamId: "current-platform-team",
        vercelProjectId: "current-platform-project",
        allowPlatformSandbox: true,
        userVercelToken: null,
        userVercelTeamId: null,
      },
      {
        billing_source: "platform",
        billing_project_id: "stale-platform-project",
        billing_team_id: "stale-platform-team",
        vercel_project_id: "stale-platform-project",
        vercel_team_id: "stale-platform-team",
      }
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
      {
        vercelToken: "platform-token",
        vercelTeamId: "platform-team",
        vercelProjectId: "platform-project",
        allowPlatformSandbox: true,
        userVercelToken: "user-token",
        userVercelTeamId: "user-team",
      },
      {
        billing_source: "user_vercel_project",
        billing_project_id: null,
        billing_team_id: null,
        vercel_project_id: null,
        vercel_team_id: null,
      }
    ),
    {
      ok: false,
      error:
        "Sandbox is missing its stored Vercel project for user-owned billing.",
      status: 400,
    }
  );
});

test("resolveSandboxTarget falls back to account default when no repo or workspace project is set", async () => {
  const { resolveSandboxTarget } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTarget({
      workspaceBillingModeInput: "user_vercel_project",
      repoBillingModeOverrideInput: null,
      accountLinkedProjectId: "prj_account",
      accountLinkedTeamId: "team_account",
    }),
    {
      ok: true,
      billingSource: "user_vercel_project",
      credentialSource: "user",
      projectId: "prj_account",
      teamId: "team_account",
    }
  );
});

test("resolveSandboxTarget prefers workspace override over account default", async () => {
  const { resolveSandboxTarget } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTarget({
      workspaceBillingModeInput: "user_vercel_project",
      workspaceLinkedProjectId: "prj_workspace",
      workspaceLinkedTeamId: "team_workspace",
      accountLinkedProjectId: "prj_account",
      accountLinkedTeamId: "team_account",
    }),
    {
      ok: true,
      billingSource: "user_vercel_project",
      credentialSource: "user",
      projectId: "prj_workspace",
      teamId: "team_workspace",
    }
  );
});

test("resolveSandboxTarget uses workspace-linked Vercel projects when repo inherits user billing", async () => {
  const { resolveSandboxTarget } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTarget({
      workspaceBillingModeInput: "user_vercel_project",
      repoBillingModeOverrideInput: null,
      workspaceLinkedProjectId: "prj_workspace",
      workspaceLinkedTeamId: "team_workspace",
    }),
    {
      ok: true,
      billingSource: "user_vercel_project",
      credentialSource: "user",
      projectId: "prj_workspace",
      teamId: "team_workspace",
    }
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
      {
        vercelToken: "platform-token",
        vercelTeamId: "platform-team",
        vercelProjectId: "platform-project",
        allowPlatformSandbox: false,
        userVercelToken: null,
        userVercelTeamId: null,
      },
      {
        ok: true,
        billingSource: "platform",
        credentialSource: "platform",
        teamId: null,
        projectId: null,
      }
    ),
    {
      ok: false,
      error:
        "Hosted sandbox compute requires a positive billing balance. Add funds or choose a plan in Settings > Billing, or link Personal Vercel and select a billing project.",
      status: 403,
    }
  );
});

test("resolveSandboxRecordCredentials blocks existing platform sandboxes for non-allowlisted users", async () => {
  const { resolveSandboxRecordCredentials } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxRecordCredentials(
      {
        vercelToken: "platform-token",
        vercelTeamId: "platform-team",
        vercelProjectId: "platform-project",
        allowPlatformSandbox: false,
        userVercelToken: null,
        userVercelTeamId: null,
      },
      {
        billing_source: "platform",
        billing_project_id: "platform-project",
        billing_team_id: null,
        vercel_project_id: "platform-project",
        vercel_team_id: null,
      }
    ),
    {
      ok: false,
      error:
        "Hosted sandbox compute requires a positive billing balance. Add funds or choose a plan in Settings > Billing, or relaunch this repo with a personal Vercel billing project.",
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
    if (savedVercelProjectId !== undefined) {
      process.env.VERCEL_PROJECT_ID = savedVercelProjectId;
    }
    if (savedPlatformProjectId !== undefined) {
      process.env.PLATFORM_VERCEL_PROJECT_ID = savedPlatformProjectId;
    }
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
    if (savedVercelProjectId !== undefined) {
      process.env.VERCEL_PROJECT_ID = savedVercelProjectId;
    }
    if (savedPlatformProjectId === undefined) {
      delete process.env.PLATFORM_VERCEL_PROJECT_ID;
    } else {
      process.env.PLATFORM_VERCEL_PROJECT_ID = savedPlatformProjectId;
    }
  }
});

test("resolveSandboxTargetCredentials rejects platform targets with a structured error when the platform project is not configured", async () => {
  const {
    resolveSandboxTargetCredentials,
    PLATFORM_VERCEL_PROJECT_NOT_CONFIGURED_ERROR,
  } = await loadSandboxCredentials();

  assert.deepEqual(
    resolveSandboxTargetCredentials(
      {
        vercelToken: "platform-token",
        vercelTeamId: "platform-team",
        vercelProjectId: null,
        allowPlatformSandbox: true,
        userVercelToken: null,
        userVercelTeamId: null,
      },
      {
        ok: true,
        billingSource: "platform",
        credentialSource: "platform",
        teamId: null,
        projectId: null,
      }
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
      {
        ok: true,
        billingSource: "user_vercel_project",
        credentialSource: "user",
        teamId: "team_linked",
        projectId: "prj_linked",
      }
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
      {
        vercelToken: "platform-token",
        vercelTeamId: "platform-team",
        vercelProjectId: null,
        allowPlatformSandbox: true,
        userVercelToken: null,
        userVercelTeamId: null,
      },
      {
        billing_source: "platform",
        billing_project_id: null,
        billing_team_id: null,
        vercel_project_id: null,
        vercel_team_id: null,
      }
    ),
    {
      ok: false,
      error: PLATFORM_VERCEL_PROJECT_NOT_CONFIGURED_ERROR,
      status: 500,
    }
  );
});
