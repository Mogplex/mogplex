"use client";

import type { Repo, Workspace } from "@/lib/types";
import { RepoSettingsDialog } from "@/components/repo-settings-dialog";
import { WorkspaceDialog } from "@/components/workspace-dialog";
import { CreateWorkspaceRepoDialog } from "@/components/create-workspace-repo-dialog";
import { MonorepoBrowser } from "@/components/monorepo-browser";

export function RepoDashboardDialogs({
  browsingMonorepo,
  creatingRepoWorkspace,
  creatingWorkspace,
  editingRepo,
  editingWorkspace,
  fetchData,
  restartRepoSandbox,
  saveRepoSettings,
  setBrowsingMonorepo,
  setCreatingRepoWorkspace,
  setCreatingWorkspace,
  setEditingRepo,
  setEditingWorkspace,
}: {
  browsingMonorepo: Repo | null;
  creatingRepoWorkspace: Workspace | null;
  creatingWorkspace: boolean;
  editingRepo: Repo | null;
  editingWorkspace: Workspace | null;
  fetchData: () => Promise<void>;
  restartRepoSandbox: (repo: Repo) => Promise<void>;
  saveRepoSettings: (repo: Repo) => Promise<void>;
  setBrowsingMonorepo: (repo: Repo | null) => void;
  setCreatingRepoWorkspace: (workspace: Workspace | null) => void;
  setCreatingWorkspace: (value: boolean) => void;
  setEditingRepo: (repo: Repo | null) => void;
  setEditingWorkspace: (workspace: Workspace | null) => void;
}) {
  return (
    <>
      {editingRepo && (
        <RepoSettingsDialog
          repo={editingRepo}
          onClose={() => setEditingRepo(null)}
          onSave={saveRepoSettings}
          onRestart={restartRepoSandbox}
        />
      )}

      {creatingWorkspace && (
        <WorkspaceDialog
          onClose={() => setCreatingWorkspace(false)}
          onSaved={() => void fetchData()}
        />
      )}

      {editingWorkspace && (
        <WorkspaceDialog
          workspace={editingWorkspace}
          onClose={() => setEditingWorkspace(null)}
          onSaved={() => void fetchData()}
        />
      )}

      {creatingRepoWorkspace && (
        <CreateWorkspaceRepoDialog
          workspace={creatingRepoWorkspace}
          onClose={() => setCreatingRepoWorkspace(null)}
          onCreated={() => void fetchData()}
        />
      )}

      {browsingMonorepo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          onClick={() => setBrowsingMonorepo(null)}
        >
          <div
            className="border-border bg-card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border p-4 sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-foreground text-sm font-medium">
                  {browsingMonorepo.full_name}
                </div>
                <div className="text-muted-foreground text-xs">
                  Add sub-project repositories from this monorepo
                </div>
              </div>
              <button
                onClick={() => setBrowsingMonorepo(null)}
                className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 overflow-auto">
              <MonorepoBrowser
                repoId={browsingMonorepo.id}
                onSpaceAdded={() => void fetchData()}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
