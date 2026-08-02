import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  reconcileStoredRepoVercelLink,
  reconcileStoredWorkspaceVercelLink,
} from "@/lib/vercel/reconciliation";
import type {
  PersistedVercelLinkState,
  RepoVercelLinkRecord,
  WorkspaceVercelLinkRecord,
} from "@/lib/vercel/reconciliation";

export type VercelLinkReconciliationSummary = {
  processed: number;
  valid: number;
  missing_project: number;
  auth_invalid: number;
  inaccessible: number;
  failed: number;
};

export type VercelLinkReconciliationState = Pick<
  PersistedVercelLinkState,
  | "vercel_link_status"
  | "vercel_link_checked_at"
  | "vercel_link_error_code"
  | "vercel_link_message"
>;

export type RunVercelLinkReconciliationDeps = {
  loadWorkspaceCandidates: () => Promise<WorkspaceVercelLinkRecord[]>;
  loadRepoCandidates: () => Promise<RepoVercelLinkRecord[]>;
  reconcileStoredWorkspaceVercelLink: typeof reconcileStoredWorkspaceVercelLink;
  reconcileStoredRepoVercelLink: typeof reconcileStoredRepoVercelLink;
  updateWorkspaceLinkState: (
    id: string,
    state: VercelLinkReconciliationState
  ) => Promise<void>;
  updateRepoLinkState: (
    id: string,
    state: VercelLinkReconciliationState
  ) => Promise<void>;
};

export function buildVercelLinkReconciliationMessage(
  summary: VercelLinkReconciliationSummary
) {
  return `Reconciled ${summary.processed} Vercel billing link(s)`;
}

const defaultDeps: RunVercelLinkReconciliationDeps = {
  async loadWorkspaceCandidates() {
    const { data, error } = await supabaseAdmin
      .from("workspaces")
      .select(
        "id, user_id, sandbox_billing_mode, sandbox_vercel_project_id, sandbox_vercel_team_id"
      )
      .or(
        "sandbox_billing_mode.eq.user_vercel_project,sandbox_vercel_project_id.not.is.null"
      );

    if (error) {
      throw new Error(
        `Failed to load workspace Vercel link candidates: ${error.message}`
      );
    }

    return (data ?? []) as WorkspaceVercelLinkRecord[];
  },
  async loadRepoCandidates() {
    const { data, error } = await supabaseAdmin
      .from("repos")
      .select(
        "id, user_id, sandbox_billing_mode_override, vercel_project_id, vercel_team_id, workspace:workspaces(sandbox_billing_mode, sandbox_vercel_project_id, sandbox_vercel_team_id)"
      )
      .or(
        "sandbox_billing_mode_override.eq.user_vercel_project,vercel_project_id.not.is.null"
      );

    if (error) {
      throw new Error(
        `Failed to load repo Vercel link candidates: ${error.message}`
      );
    }

    return (data ?? []) as RepoVercelLinkRecord[];
  },
  reconcileStoredWorkspaceVercelLink,
  reconcileStoredRepoVercelLink,
  async updateWorkspaceLinkState(id, state) {
    const { error } = await supabaseAdmin
      .from("workspaces")
      .update(state)
      .eq("id", id);

    if (error) {
      throw new Error(
        `Failed to persist workspace Vercel link state for ${id}: ${error.message}`
      );
    }
  },
  async updateRepoLinkState(id, state) {
    const { error } = await supabaseAdmin
      .from("repos")
      .update(state)
      .eq("id", id);

    if (error) {
      throw new Error(
        `Failed to persist repo Vercel link state for ${id}: ${error.message}`
      );
    }
  },
};

export async function runVercelLinkReconciliation(
  overrides: Partial<RunVercelLinkReconciliationDeps> = {}
) {
  const deps: RunVercelLinkReconciliationDeps = {
    ...defaultDeps,
    ...overrides,
  };

  const summary: VercelLinkReconciliationSummary = {
    processed: 0,
    valid: 0,
    missing_project: 0,
    auth_invalid: 0,
    inaccessible: 0,
    failed: 0,
  };

  const [workspaces, repos] = await Promise.all([
    deps.loadWorkspaceCandidates(),
    deps.loadRepoCandidates(),
  ]);

  for (const workspace of workspaces) {
    summary.processed += 1;
    try {
      const result = await deps.reconcileStoredWorkspaceVercelLink(workspace);
      if (result.outcome === "failed") {
        summary.failed += 1;
        continue;
      }

      await deps.updateWorkspaceLinkState(workspace.id, result.state);
      if (result.state.vercel_link_status !== "unknown") {
        summary[result.state.vercel_link_status] += 1;
      }
    } catch {
      summary.failed += 1;
    }
  }

  for (const repo of repos) {
    summary.processed += 1;
    try {
      const result = await deps.reconcileStoredRepoVercelLink(repo);
      if (result.outcome === "failed") {
        summary.failed += 1;
        continue;
      }

      await deps.updateRepoLinkState(repo.id, result.state);
      if (result.state.vercel_link_status !== "unknown") {
        summary[result.state.vercel_link_status] += 1;
      }
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}
