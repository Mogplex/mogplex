import assert from "node:assert/strict";
import test from "node:test";

async function loadReconciliation() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/vercel/reconciliation");
}

test("workspace reconciliation reports missing_project when user billing has no linked project", async () => {
  const { reconcileStoredWorkspaceVercelLink } = await loadReconciliation();

  const result = await reconcileStoredWorkspaceVercelLink(
    {
      id: "ws-1",
      user_id: "user-123",
      sandbox_billing_mode: "user_vercel_project",
      sandbox_vercel_project_id: null,
      sandbox_vercel_team_id: null,
    },
    {
      now: () => "2026-04-02T16:00:00.000Z",
    }
  );

  assert.deepEqual(result, {
    outcome: "updated",
    state: {
      vercel_link_status: "missing_project",
      vercel_link_checked_at: "2026-04-02T16:00:00.000Z",
      vercel_link_error_code: "MISSING_PROJECT",
      vercel_link_message:
        "Select or create a workspace-linked Vercel project to keep user-billed sandbox launch working.",
    },
  });
});

test("workspace reconciliation reports auth_invalid when Personal Vercel is not linked", async () => {
  const { reconcileStoredWorkspaceVercelLink } = await loadReconciliation();

  const result = await reconcileStoredWorkspaceVercelLink(
    {
      id: "ws-1",
      user_id: "user-123",
      sandbox_billing_mode: "user_vercel_project",
      sandbox_vercel_project_id: "prj_workspace",
      sandbox_vercel_team_id: "team-acme",
    },
    {
      now: () => "2026-04-02T16:00:00.000Z",
      loadUserVercelCredentials: async () => ({
        userVercelToken: null,
        userVercelTeamId: null,
        accountDefaultVercelProjectId: null,
        accountDefaultVercelTeamId: null,
      }),
    }
  );

  assert.deepEqual(result, {
    outcome: "updated",
    state: {
      vercel_link_status: "auth_invalid",
      vercel_link_checked_at: "2026-04-02T16:00:00.000Z",
      vercel_link_error_code: "PERSONAL_VERCEL_NOT_LINKED",
      vercel_link_message:
        "Link Personal Vercel to keep using your own Vercel project for sandbox billing.",
    },
  });
});

test("workspace reconciliation does not persist transient validation failures", async () => {
  const { reconcileStoredWorkspaceVercelLink } = await loadReconciliation();

  const result = await reconcileStoredWorkspaceVercelLink(
    {
      id: "ws-1",
      user_id: "user-123",
      sandbox_billing_mode: "user_vercel_project",
      sandbox_vercel_project_id: "prj_workspace",
      sandbox_vercel_team_id: "team-acme",
    },
    {
      loadUserVercelCredentials: async () => ({
        userVercelToken: "user-token",
        userVercelTeamId: "team-acme",
        accountDefaultVercelProjectId: null,
        accountDefaultVercelTeamId: null,
      }),
      validateVercelProjectAccess: async () => ({
        ok: false as const,
        error: {
          code: "RATE_LIMITED",
          status: 429,
          message: "slow down",
        },
      }),
    }
  );

  assert.deepEqual(result, {
    outcome: "failed",
    reason: "slow down",
  });
});

test("repo reconciliation reports missing_project when repo override is enabled without a repo-linked project", async () => {
  const { reconcileStoredRepoVercelLink } = await loadReconciliation();

  const result = await reconcileStoredRepoVercelLink(
    {
      id: "repo-1",
      user_id: "user-123",
      sandbox_billing_mode_override: "user_vercel_project",
      vercel_project_id: null,
      vercel_team_id: null,
      workspace: {
        sandbox_billing_mode: "platform",
        sandbox_vercel_project_id: null,
        sandbox_vercel_team_id: null,
      },
    },
    {
      now: () => "2026-04-02T16:00:00.000Z",
    }
  );

  assert.deepEqual(result, {
    outcome: "updated",
    state: {
      vercel_link_status: "missing_project",
      vercel_link_checked_at: "2026-04-02T16:00:00.000Z",
      vercel_link_error_code: "MISSING_PROJECT",
      vercel_link_message:
        "Select or create a repo-linked Vercel project to keep user-billed sandbox launch working.",
    },
  });
});

test("repo reconciliation leaves repo state unknown when workspace owns user billing", async () => {
  const { reconcileStoredRepoVercelLink } = await loadReconciliation();

  const result = await reconcileStoredRepoVercelLink({
    id: "repo-1",
    user_id: "user-123",
    sandbox_billing_mode_override: null,
    vercel_project_id: null,
    vercel_team_id: null,
    workspace: {
      sandbox_billing_mode: "user_vercel_project",
      sandbox_vercel_project_id: "workspace-project",
      sandbox_vercel_team_id: "team-workspace",
    },
  });

  assert.deepEqual(result, {
    outcome: "updated",
    state: {
      vercel_link_status: "unknown",
      vercel_link_checked_at: null,
      vercel_link_error_code: null,
      vercel_link_message: null,
    },
  });
});

test("reconciliation reset helpers only trigger for Vercel billing settings", async () => {
  const {
    shouldResetRepoVercelLinkState,
    shouldResetWorkspaceVercelLinkState,
  } = await loadReconciliation();

  assert.equal(
    shouldResetRepoVercelLinkState({ vercel_project_id: "prj_1" }),
    true
  );
  assert.equal(
    shouldResetRepoVercelLinkState({
      sandbox_billing_mode_override: "platform",
    }),
    true
  );
  assert.equal(
    shouldResetRepoVercelLinkState({ full_name: "acme/repo" }),
    false
  );

  assert.equal(
    shouldResetWorkspaceVercelLinkState({ sandbox_vercel_project_id: "prj_1" }),
    true
  );
  assert.equal(
    shouldResetWorkspaceVercelLinkState({ sandbox_billing_mode: "platform" }),
    true
  );
  assert.equal(
    shouldResetWorkspaceVercelLinkState({ name: "Workspace A" }),
    false
  );
});
