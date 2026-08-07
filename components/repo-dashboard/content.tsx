"use client";

import type {
  Agent,
  Assignment,
  Repo,
  SandboxRecord,
  Workspace,
} from "@/lib/types";
import { useUser } from "@/hooks/use-user";
import { getRepoDashboardRootState } from "./helpers";
import { RepoDashboardHeader, RepoDashboardStatusMessages } from "./header";
import {
  RepoDashboardFailureView,
  RepoDashboardEmptyView,
} from "./empty-state";
import { RepoDashboardDialogs } from "./dialogs";
import { WorkspaceSectionPanel } from "./workspace-section";
import type {
  GithubSetupState,
  VercelSetupState,
  WorkspaceSection,
} from "./types";

interface RepoDashboardContentProps {
  activePreviewCount: number;
  agents: Agent[];
  browsingMonorepo: Repo | null;
  connectGithubLabel: string;
  creatingRepoWorkspace: Workspace | null;
  creatingWorkspace: boolean;
  dataLoadError: string | null;
  editingRepo: Repo | null;
  editingWorkspace: Workspace | null;
  fetchData: () => Promise<void>;
  filteredReposLength: number;
  githubSetup: GithubSetupState;
  vercelSetup: VercelSetupState;
  handleDeleteWorkspace: (workspace: Workspace) => Promise<void>;
  handleLaunchSandbox: (repo: Repo, trigger?: string) => Promise<void>;
  handleStopSandbox: (repoId: string) => Promise<void>;
  hiddenCount: number;
  hideByOwner: (owner: string) => Promise<void>;
  hideRepo: (repo: Repo) => Promise<void>;
  isCreatingRepo: (repoId: string) => boolean;
  onOpenChat: (repo: Repo) => void;
  ownerFilter: string;
  owners: string[];
  repoAgentsMap: Map<string, Agent[]>;
  repoCronsMap: Map<string, Assignment[]>;
  repoSyncError: string | null;
  repos: Repo[];
  restartRepoSandbox: (repo: Repo) => Promise<void>;
  saveRepoSettings: (repo: Repo) => Promise<void>;
  sandboxes: Record<string, SandboxRecord | null | undefined>;
  search: string;
  selected: string | null;
  setBrowsingMonorepo: (repo: Repo | null) => void;
  setCreatingRepoWorkspace: (workspace: Workspace | null) => void;
  setCreatingWorkspace: (value: boolean) => void;
  setEditingRepo: (repo: Repo | null) => void;
  setEditingWorkspace: (workspace: Workspace | null) => void;
  setHasAttemptedRepoSync: (value: boolean) => void;
  setOwnerFilter: (value: string) => void;
  setSearch: (value: string) => void;
  setSelected: (value: string | null) => void;
  setShowHidden: (updater: (current: boolean) => boolean) => void;
  setViewMode: (value: "grid" | "list") => void;
  showHidden: boolean;
  syncGithubRepos: (source?: string) => Promise<void>;
  syncingRepos: boolean;
  user: ReturnType<typeof useUser>["user"];
  viewMode: "grid" | "list";
  visibleRepoCount: number;
  visibleWorkspaceCount: number;
  onToggleFavorite: (repo: Repo) => Promise<void>;
  workspaceSections: WorkspaceSection[];
  workspaces: Workspace[];
}

function RepoDashboardMainContent({
  activePreviewCount,
  browsingMonorepo,
  connectGithubLabel,
  creatingRepoWorkspace,
  creatingWorkspace,
  dataLoadError,
  editingRepo,
  editingWorkspace,
  fetchData,
  filteredReposLength,
  githubSetup,
  handleDeleteWorkspace,
  handleLaunchSandbox,
  handleStopSandbox,
  hiddenCount,
  hideByOwner,
  hideRepo,
  isCreatingRepo,
  onOpenChat,
  onToggleFavorite,
  ownerFilter,
  owners,
  repoAgentsMap,
  repoCronsMap,
  repoSyncError,
  repos,
  restartRepoSandbox,
  saveRepoSettings,
  sandboxes,
  search,
  selected,
  setBrowsingMonorepo,
  setCreatingRepoWorkspace,
  setCreatingWorkspace,
  setEditingRepo,
  setEditingWorkspace,
  setHasAttemptedRepoSync,
  setOwnerFilter,
  setSearch,
  setSelected,
  setShowHidden,
  setViewMode,
  showHidden,
  syncGithubRepos,
  syncingRepos,
  viewMode,
  visibleRepoCount,
  visibleWorkspaceCount,
  workspaceSections,
}: Omit<
  RepoDashboardContentProps,
  "user" | "workspaces" | "vercelSetup" | "agents"
>) {
  const showNoResults =
    workspaceSections.length === 0 &&
    (repos.length > 0 || filteredReposLength > 0);

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <RepoDashboardHeader
        activePreviewCount={activePreviewCount}
        filteredReposLength={filteredReposLength}
        githubSetup={githubSetup}
        hiddenCount={hiddenCount}
        onCreateWorkspace={() => setCreatingWorkspace(true)}
        onHideByOwner={() => void hideByOwner(ownerFilter)}
        onSearchChange={setSearch}
        onSelectOwner={setOwnerFilter}
        onSelectView={setViewMode}
        onSyncGithub={() => {
          setHasAttemptedRepoSync(true);
          void syncGithubRepos("repo_dashboard_toolbar");
        }}
        onToggleShowHidden={() => setShowHidden((current) => !current)}
        ownerFilter={ownerFilter}
        owners={owners}
        search={search}
        showHidden={showHidden}
        syncingRepos={syncingRepos}
        viewMode={viewMode}
        visibleRepoCount={visibleRepoCount}
        visibleWorkspaceCount={visibleWorkspaceCount}
      />

      <RepoDashboardStatusMessages
        dataLoadError={dataLoadError}
        repoSyncError={repoSyncError}
        syncingRepos={syncingRepos}
      />

      <div className="flex-1 overflow-auto px-4 py-3">
        <div className="space-y-6">
          {workspaceSections.map((section) => (
            <WorkspaceSectionPanel
              key={section.workspace.id}
              connectGithubLabel={connectGithubLabel}
              getRepoSandbox={(repoId) => sandboxes[repoId] || null}
              githubSetup={githubSetup}
              isCreatingRepo={isCreatingRepo}
              onBrowseMonorepo={setBrowsingMonorepo}
              onCreateRepoWorkspace={setCreatingRepoWorkspace}
              onDeleteWorkspace={handleDeleteWorkspace}
              onEditRepo={setEditingRepo}
              onEditWorkspace={setEditingWorkspace}
              onHideRepo={hideRepo}
              onLaunchSandbox={handleLaunchSandbox}
              onOpenChat={onOpenChat}
              onSelectRepo={setSelected}
              onStopSandbox={handleStopSandbox}
              onToggleFavorite={(repo) => void onToggleFavorite(repo)}
              repoAgentsMap={repoAgentsMap}
              repoCronsMap={repoCronsMap}
              section={section}
              selectedRepoId={selected}
              viewMode={viewMode}
            />
          ))}
        </div>

        {showNoResults ? (
          <div className="text-muted-foreground py-12 text-center text-xs">
            No repositories match the current filters.
          </div>
        ) : null}
      </div>
      <RepoDashboardDialogs
        browsingMonorepo={browsingMonorepo}
        creatingRepoWorkspace={creatingRepoWorkspace}
        creatingWorkspace={creatingWorkspace}
        editingRepo={editingRepo}
        editingWorkspace={editingWorkspace}
        fetchData={fetchData}
        restartRepoSandbox={restartRepoSandbox}
        saveRepoSettings={saveRepoSettings}
        setBrowsingMonorepo={setBrowsingMonorepo}
        setCreatingRepoWorkspace={setCreatingRepoWorkspace}
        setCreatingWorkspace={setCreatingWorkspace}
        setEditingRepo={setEditingRepo}
        setEditingWorkspace={setEditingWorkspace}
      />
    </div>
  );
}

export function RepoDashboardContent(props: RepoDashboardContentProps) {
  const rootState = getRepoDashboardRootState({
    dataLoadError: props.dataLoadError,
    repoCount: props.repos.length,
    syncingRepos: props.syncingRepos,
    workspaceCount: props.workspaces.length,
  });

  switch (rootState) {
    case "failure":
      return (
        <RepoDashboardFailureView
          dataLoadError={props.dataLoadError}
          fetchData={props.fetchData}
          user={props.user}
        />
      );
    case "empty":
      return (
        <RepoDashboardEmptyView
          creatingWorkspace={props.creatingWorkspace}
          fetchData={props.fetchData}
          githubSetup={props.githubSetup}
          vercelSetup={props.vercelSetup}
          repoSyncError={props.repoSyncError}
          setCreatingWorkspace={props.setCreatingWorkspace}
          setHasAttemptedRepoSync={props.setHasAttemptedRepoSync}
          syncGithubRepos={props.syncGithubRepos}
          syncingRepos={props.syncingRepos}
          user={props.user}
        />
      );
    default:
      return (
        <RepoDashboardMainContent
          activePreviewCount={props.activePreviewCount}
          browsingMonorepo={props.browsingMonorepo}
          connectGithubLabel={props.connectGithubLabel}
          creatingRepoWorkspace={props.creatingRepoWorkspace}
          creatingWorkspace={props.creatingWorkspace}
          dataLoadError={props.dataLoadError}
          editingRepo={props.editingRepo}
          editingWorkspace={props.editingWorkspace}
          fetchData={props.fetchData}
          filteredReposLength={props.filteredReposLength}
          githubSetup={props.githubSetup}
          handleDeleteWorkspace={props.handleDeleteWorkspace}
          handleLaunchSandbox={props.handleLaunchSandbox}
          handleStopSandbox={props.handleStopSandbox}
          hiddenCount={props.hiddenCount}
          hideByOwner={props.hideByOwner}
          hideRepo={props.hideRepo}
          isCreatingRepo={props.isCreatingRepo}
          onOpenChat={props.onOpenChat}
          onToggleFavorite={props.onToggleFavorite}
          ownerFilter={props.ownerFilter}
          owners={props.owners}
          repoAgentsMap={props.repoAgentsMap}
          repoCronsMap={props.repoCronsMap}
          repoSyncError={props.repoSyncError}
          repos={props.repos}
          restartRepoSandbox={props.restartRepoSandbox}
          saveRepoSettings={props.saveRepoSettings}
          sandboxes={props.sandboxes}
          search={props.search}
          selected={props.selected}
          setBrowsingMonorepo={props.setBrowsingMonorepo}
          setCreatingRepoWorkspace={props.setCreatingRepoWorkspace}
          setCreatingWorkspace={props.setCreatingWorkspace}
          setEditingRepo={props.setEditingRepo}
          setEditingWorkspace={props.setEditingWorkspace}
          setHasAttemptedRepoSync={props.setHasAttemptedRepoSync}
          setOwnerFilter={props.setOwnerFilter}
          setSearch={props.setSearch}
          setSelected={props.setSelected}
          setShowHidden={props.setShowHidden}
          setViewMode={props.setViewMode}
          showHidden={props.showHidden}
          syncGithubRepos={props.syncGithubRepos}
          syncingRepos={props.syncingRepos}
          viewMode={props.viewMode}
          visibleRepoCount={props.visibleRepoCount}
          visibleWorkspaceCount={props.visibleWorkspaceCount}
          workspaceSections={props.workspaceSections}
        />
      );
  }
}
