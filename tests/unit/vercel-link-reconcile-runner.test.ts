import assert from "node:assert/strict";
import test from "node:test";

async function loadReconcileRunner() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/vercel/reconcile-links-runner");
}

test("runVercelLinkReconciliation summarizes persisted outcomes and keeps going past row failures", async () => {
  const { buildVercelLinkReconciliationMessage, runVercelLinkReconciliation } =
    await loadReconcileRunner();
  const workspaceUpdates: Array<{ id: string; status: string }> = [];
  const repoUpdates: Array<{ id: string; status: string }> = [];

  const summary = await runVercelLinkReconciliation({
    loadWorkspaceCandidates: async () => [
      {
        id: "ws-valid",
        user_id: "user-1",
        sandbox_billing_mode: "user_vercel_project",
        sandbox_vercel_project_id: "prj_1",
        sandbox_vercel_team_id: "team_1",
      },
      {
        id: "ws-failed",
        user_id: "user-2",
        sandbox_billing_mode: "user_vercel_project",
        sandbox_vercel_project_id: "prj_2",
        sandbox_vercel_team_id: "team_2",
      },
    ],
    loadRepoCandidates: async () => [
      {
        id: "repo-missing",
        user_id: "user-1",
        sandbox_billing_mode_override: "user_vercel_project",
        vercel_project_id: null,
        vercel_team_id: null,
        workspace: null,
      },
      {
        id: "repo-unknown",
        user_id: "user-1",
        sandbox_billing_mode_override: null,
        vercel_project_id: null,
        vercel_team_id: null,
        workspace: {
          sandbox_billing_mode: "platform",
          sandbox_vercel_project_id: null,
          sandbox_vercel_team_id: null,
        },
      },
    ],
    reconcileStoredWorkspaceVercelLink: async (workspace) => {
      if (workspace.id === "ws-failed") {
        return { outcome: "failed" as const, reason: "rate limited" };
      }

      return {
        outcome: "updated" as const,
        state: {
          vercel_link_status: "valid" as const,
          vercel_link_checked_at: "2026-04-02T16:00:00.000Z",
          vercel_link_error_code: null,
          vercel_link_message:
            "workspace-linked Vercel project is reachable and ready for user-billed sandbox launch.",
        },
      };
    },
    reconcileStoredRepoVercelLink: async (repo) => {
      if (repo.id === "repo-missing") {
        return {
          outcome: "updated" as const,
          state: {
            vercel_link_status: "missing_project" as const,
            vercel_link_checked_at: "2026-04-02T16:00:00.000Z",
            vercel_link_error_code: "MISSING_PROJECT" as const,
            vercel_link_message:
              "Select or create a repo-linked Vercel project to keep user-billed sandbox launch working.",
          },
        };
      }

      return {
        outcome: "updated" as const,
        state: {
          vercel_link_status: "unknown" as const,
          vercel_link_checked_at: null,
          vercel_link_error_code: null,
          vercel_link_message: null,
        },
      };
    },
    updateWorkspaceLinkState: async (id, state) => {
      workspaceUpdates.push({ id, status: state.vercel_link_status });
    },
    updateRepoLinkState: async (id, state) => {
      repoUpdates.push({ id, status: state.vercel_link_status });
    },
  });

  assert.deepEqual(summary, {
    processed: 4,
    valid: 1,
    missing_project: 1,
    auth_invalid: 0,
    inaccessible: 0,
    failed: 1,
  });
  assert.equal(
    buildVercelLinkReconciliationMessage(summary),
    "Reconciled 4 Vercel billing link(s)"
  );
  assert.deepEqual(workspaceUpdates, [{ id: "ws-valid", status: "valid" }]);
  assert.deepEqual(repoUpdates, [
    { id: "repo-missing", status: "missing_project" },
    { id: "repo-unknown", status: "unknown" },
  ]);
});

test("runVercelLinkReconciliation keeps going when per-row reconciliation or persistence throws", async () => {
  const { runVercelLinkReconciliation } = await loadReconcileRunner();
  const persisted: string[] = [];

  const summary = await runVercelLinkReconciliation({
    loadWorkspaceCandidates: async () => [
      {
        id: "ws-throws",
        user_id: "user-1",
        sandbox_billing_mode: "user_vercel_project",
        sandbox_vercel_project_id: "prj_1",
        sandbox_vercel_team_id: "team_1",
      },
      {
        id: "ws-valid",
        user_id: "user-1",
        sandbox_billing_mode: "user_vercel_project",
        sandbox_vercel_project_id: "prj_2",
        sandbox_vercel_team_id: "team_2",
      },
    ],
    loadRepoCandidates: async () => [
      {
        id: "repo-persist-throws",
        user_id: "user-1",
        sandbox_billing_mode_override: "user_vercel_project",
        vercel_project_id: "prj_3",
        vercel_team_id: "team_3",
        workspace: null,
      },
      {
        id: "repo-valid",
        user_id: "user-1",
        sandbox_billing_mode_override: "user_vercel_project",
        vercel_project_id: "prj_4",
        vercel_team_id: "team_4",
        workspace: null,
      },
    ],
    reconcileStoredWorkspaceVercelLink: async (workspace) => {
      if (workspace.id === "ws-throws") {
        throw new Error("workspace exploded");
      }

      return {
        outcome: "updated" as const,
        state: {
          vercel_link_status: "valid" as const,
          vercel_link_checked_at: "2026-04-02T16:00:00.000Z",
          vercel_link_error_code: null,
          vercel_link_message: "ok",
        },
      };
    },
    reconcileStoredRepoVercelLink: async () => ({
      outcome: "updated" as const,
      state: {
        vercel_link_status: "valid" as const,
        vercel_link_checked_at: "2026-04-02T16:00:00.000Z",
        vercel_link_error_code: null,
        vercel_link_message: "ok",
      },
    }),
    updateWorkspaceLinkState: async (id) => {
      persisted.push(id);
    },
    updateRepoLinkState: async (id) => {
      if (id === "repo-persist-throws") {
        throw new Error("repo persistence exploded");
      }

      persisted.push(id);
    },
  });

  assert.deepEqual(summary, {
    processed: 4,
    valid: 2,
    missing_project: 0,
    auth_invalid: 0,
    inaccessible: 0,
    failed: 2,
  });
  assert.deepEqual(persisted, ["ws-valid", "repo-valid"]);
});
