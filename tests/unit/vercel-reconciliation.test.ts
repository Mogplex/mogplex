import assert from "node:assert/strict";
import test from "node:test";

async function loadReconciliation() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/vercel/reconciliation");
}

const unknownState = {
  vercel_link_status: "unknown" as const,
  vercel_link_checked_at: null,
  vercel_link_error_code: null,
  vercel_link_message: null,
};

test("workspace reconciliation clears legacy user-billing state without Vercel calls", async () => {
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
      loadUserVercelCredentials: async () => {
        throw new Error("disabled reconciliation must not load credentials");
      },
      validateVercelProjectAccess: async () => {
        throw new Error("disabled reconciliation must not call Vercel");
      },
    }
  );

  assert.deepEqual(result, { outcome: "updated", state: unknownState });
});

test("repo reconciliation clears legacy user-billing link state", async () => {
  const { reconcileStoredRepoVercelLink } = await loadReconciliation();
  const result = await reconcileStoredRepoVercelLink({
    id: "repo-1",
    user_id: "user-123",
    sandbox_billing_mode_override: "user_vercel_project",
    vercel_project_id: "prj_repo",
    vercel_team_id: "team-acme",
    workspace: { sandbox_billing_mode: "platform" },
  });

  assert.deepEqual(result, { outcome: "updated", state: unknownState });
});

test("repo reconciliation leaves state unknown when a legacy workspace owns the link", async () => {
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

  assert.deepEqual(result, { outcome: "updated", state: unknownState });
});

test("reconciliation reset helpers only trigger for Vercel settings", async () => {
  const {
    shouldResetRepoVercelLinkState,
    shouldResetWorkspaceVercelLinkState,
  } = await loadReconciliation();

  assert.equal(
    shouldResetRepoVercelLinkState({ vercel_project_id: "prj_1" }),
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
    shouldResetWorkspaceVercelLinkState({ name: "Workspace A" }),
    false
  );
});
