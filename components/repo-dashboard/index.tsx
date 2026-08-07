"use client";

import { RepoDashboardContent } from "./content";
import { useRepoDashboard } from "./use-repo-dashboard";
import type { RepoDashboardProps } from "./types";

export type { RepoDashboardProps };

export function RepoDashboard({
  onOpenChat,
  onReposLoaded,
}: RepoDashboardProps) {
  const state = useRepoDashboard({ onOpenChat, onReposLoaded });

  return (
    <RepoDashboardContent
      activePreviewCount={state.activePreviewCount}
      agents={state.agents}
      browsingMonorepo={state.browsingMonorepo}
      connectGithubLabel={state.connectGithubLabel}
      creatingRepoWorkspace={state.creatingRepoWorkspace}
      creatingWorkspace={state.creatingWorkspace}
      dataLoadError={state.dataLoadError}
      editingRepo={state.editingRepo}
      editingWorkspace={state.editingWorkspace}
      fetchData={state.fetchData}
      filteredReposLength={state.filteredRepos.length}
      githubSetup={state.githubSetup}
      vercelSetup={state.vercelSetup}
      handleDeleteWorkspace={state.handleDeleteWorkspace}
      handleLaunchSandbox={state.handleLaunchSandbox}
      handleStopSandbox={state.handleStopSandbox}
      hiddenCount={state.hiddenCount}
      hideByOwner={state.hideByOwner}
      hideRepo={state.hideRepo}
      isCreatingRepo={state.hasCreatingForRepo}
      onOpenChat={state.onOpenChat}
      onToggleFavorite={state.toggleFavorite}
      ownerFilter={state.ownerFilter}
      owners={state.owners}
      repoAgentsMap={state.repoAgentsMap}
      repoCronsMap={state.repoCronsMap}
      repoSyncError={state.repoSyncError}
      repos={state.repos}
      restartRepoSandbox={state.restartRepoSandbox}
      saveRepoSettings={state.saveRepoSettings}
      sandboxes={state.sandboxes}
      search={state.search}
      selected={state.selected}
      setBrowsingMonorepo={state.setBrowsingMonorepo}
      setCreatingRepoWorkspace={state.setCreatingRepoWorkspace}
      setCreatingWorkspace={state.setCreatingWorkspace}
      setEditingRepo={state.setEditingRepo}
      setEditingWorkspace={state.setEditingWorkspace}
      setHasAttemptedRepoSync={state.setHasAttemptedRepoSync}
      setOwnerFilter={state.setOwnerFilter}
      setSearch={state.setSearch}
      setSelected={state.setSelected}
      setShowHidden={state.setShowHidden}
      setViewMode={state.setViewMode}
      showHidden={state.showHidden}
      syncGithubRepos={state.syncGithubRepos}
      syncingRepos={state.syncingRepos}
      user={state.user}
      viewMode={state.viewMode}
      visibleRepoCount={state.visibleRepoCount}
      visibleWorkspaceCount={state.visibleWorkspaceCount}
      workspaceSections={state.workspaceSections}
      workspaces={state.workspaces}
    />
  );
}
