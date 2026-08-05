"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { scopedHref } from "@/lib/scoped-href"
import type { Repo, Agent, Assignment, SandboxRecord, Workspace } from "@/lib/types"
import { useSandboxStore } from "@/hooks/use-sandbox"
import { useUser } from "@/hooks/use-user"
import { filterRepos } from "@/lib/repo-search"
import {
  getSandboxUiPreviewUrl,
  getSandboxUiRuntimeStatus,
  isSandboxUiBooting,
  isSandboxUiIdleWarning,
  isSandboxUiReachablePreview,
  isSandboxUiRuntimeRunning,
  resolveSandboxUiState,
  type SandboxUiState,
} from "@/lib/sandbox/ui-state"
import { cn } from "@/lib/utils"
import { RepoSettingsDialog } from "./repo-settings-dialog"
import { WorkspaceDialog } from "./workspace-dialog"
import { CreateWorkspaceRepoDialog } from "./create-workspace-repo-dialog"
import { MonorepoBrowser } from "./monorepo-browser"
import { MoreHoriz } from "iconoir-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider"
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider"
import { toast } from "@/hooks/use-toast"
import { useSessionsStore } from "@/hooks/use-sessions"
import {
  bindSessionToPendingSandboxBranch,
  ensureSessionSandboxBinding,
} from "@/lib/sandbox/session-retarget"
import { trackActivation } from "@/lib/activation-tracking"
import {
  presentGithubSetup,
  presentProjectsEmptyState,
  presentRepoSyncFailure,
  presentVercelSetup,
} from "@/lib/activation/setup-state"
import { createClient as createSupabaseClient } from "@/lib/supabase/client"
import { useTableEvents } from "@/hooks/use-table-events"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useIsMobile } from "@/hooks/use-mobile"

function sortRepos(items: Repo[]) {
  return [...items].sort((a, b) => {
    const favoriteOrder = Number(Boolean(b.is_favorite)) - Number(Boolean(a.is_favorite))
    if (favoriteOrder !== 0) return favoriteOrder
    return a.full_name.localeCompare(b.full_name)
  })
}

function sortWorkspaces(items: Workspace[]) {
  return [...items].sort((a, b) => {
    const defaultOrder = Number(Boolean(b.is_default)) - Number(Boolean(a.is_default))
    if (defaultOrder !== 0) return defaultOrder
    return a.name.localeCompare(b.name)
  })
}

function getRepoOwner(repo: Repo) {
  return repo.owner || repo.full_name.split("/")[0] || "owner"
}

function getRepoName(repo: Repo) {
  return repo.name || repo.full_name.split("/")[1] || repo.full_name
}

function RepoPill({
  children,
  className,
  dotClassName,
}: {
  children: React.ReactNode
  className?: string
  dotClassName?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex cursor-default items-center gap-1.5 rounded-sm border border-border bg-accent/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {dotClassName ? <span className={cn("size-1.5 rounded-full", dotClassName)} /> : null}
      {children}
    </span>
  )
}

type WorkspaceSectionPanelProps = {
  connectGithubLabel: string
  getRepoSandbox: (repoId: string) => SandboxRecord | null
  githubSetup: GithubSetupState
  isCreatingRepo: (repoId: string) => boolean
  onBrowseMonorepo: (repo: Repo) => void
  onCreateRepoWorkspace: (workspace: Workspace) => void
  onDeleteWorkspace: (workspace: Workspace) => void
  onEditRepo: (repo: Repo) => void
  onEditWorkspace: (workspace: Workspace) => void
  onHideRepo: (repo: Repo) => void
  onLaunchSandbox: (repo: Repo) => void
  onOpenChat: (repo: Repo) => void
  onSelectRepo: (repoId: string) => void
  onStopSandbox: (repoId: string) => void
  onToggleFavorite: (repo: Repo) => void
  repoAgentsMap: Map<string, Agent[]>
  repoCronsMap: Map<string, Assignment[]>
  section: WorkspaceSection
  selectedRepoId: string | null
  viewMode: "grid" | "list"
}

function WorkspaceSectionHeader({
  canManageWorkspace,
  onCreateRepoWorkspace,
  onDeleteWorkspace,
  onEditWorkspace,
  section,
}: {
  canManageWorkspace: boolean
  onCreateRepoWorkspace: (workspace: Workspace) => void
  onDeleteWorkspace: (workspace: Workspace) => void
  onEditWorkspace: (workspace: Workspace) => void
  section: WorkspaceSection
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-sm font-medium text-foreground/90">{section.workspace.name}</h2>
          {section.workspace.is_default && (
            <RepoPill className="border-border bg-accent/80 text-muted-foreground">Imported</RepoPill>
          )}
          <span className="text-xs text-muted-foreground">
            {section.repos.length} repo{section.repos.length === 1 ? "" : "s"}
          </span>
        </div>
        {section.workspace.description && (
          <p className="mt-1 text-xs text-muted-foreground">{section.workspace.description}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canManageWorkspace && (
          <Button
            size="sm"
            onClick={() => onCreateRepoWorkspace(section.workspace)}
            className="h-8 rounded-sm text-xs"
          >
            New repo
          </Button>
        )}
        {canManageWorkspace && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 rounded-sm px-2 text-xs text-muted-foreground">
                Manage
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => onEditWorkspace(section.workspace)}>
                Rename project
              </DropdownMenuItem>
              {!section.workspace.is_default && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => void onDeleteWorkspace(section.workspace)}
                  >
                    Delete project
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

function WorkspaceSectionRepoList({
  connectGithubLabel,
  getRepoSandbox,
  githubSetup,
  isCreatingRepo,
  onBrowseMonorepo,
  canManageWorkspace,
  onCreateRepoWorkspace,
  onEditRepo,
  onHideRepo,
  onLaunchSandbox,
  onOpenChat,
  onSelectRepo,
  onStopSandbox,
  onToggleFavorite,
  repoAgentsMap,
  repoCronsMap,
  section,
  selectedRepoId,
  viewMode,
}: WorkspaceSectionPanelProps & {
  canManageWorkspace: boolean
}) {
  if (section.repos.length > 0) {
    return (
        <div
          className={
            viewMode === "grid"
              ? "grid grid-cols-1 gap-px md:grid-cols-2 2xl:grid-cols-3"
              : "flex flex-col gap-px"
          }
        >
          {section.repos.map((repo) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              sandbox={getRepoSandbox(repo.id)}
              isCreating={isCreatingRepo(repo.id)}
              agents={repoAgentsMap.get(repo.id) || []}
              crons={repoCronsMap.get(repo.id) || []}
              selected={selectedRepoId === repo.id}
              viewMode={viewMode}
              onSelect={() => onSelectRepo(repo.id)}
              onToggleFavorite={() => onToggleFavorite(repo)}
              onOpenChat={() => onOpenChat(repo)}
              onLaunchSandbox={() => onLaunchSandbox(repo)}
              onStopSandbox={() => onStopSandbox(repo.id)}
              onSettings={() => onEditRepo(repo)}
              onBrowseMonorepo={!repo.root_directory ? () => onBrowseMonorepo(repo) : undefined}
              onHide={() => onHideRepo(repo)}
            />
          ))}
        </div>
    )
  }

  return (
    <div className="rounded-md border border-border bg-card px-4 py-5 text-sm text-muted-foreground">
      <div className="font-medium text-foreground/80">No repos yet</div>
      <p className="mt-1 text-xs text-muted-foreground">
        {githubSetup.canSyncRepos
          ? "Create a new GitHub repo in this project."
          : `${githubSetup.primaryAction?.label || connectGithubLabel} before creating repos in this project.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {githubSetup.canSyncRepos ? (
          <Button
            size="sm"
            onClick={() => onCreateRepoWorkspace(section.workspace)}
            disabled={!canManageWorkspace}
            className="h-8 rounded-sm text-xs"
          >
            Create repo
          </Button>
        ) : githubSetup.primaryAction ? (
          <Button asChild size="sm" className="h-8 rounded-sm text-xs">
            <a
              href={githubSetup.primaryAction.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {githubSetup.primaryAction.label}
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function WorkspaceSectionPanel(props: WorkspaceSectionPanelProps) {
  const canManageWorkspace = !props.section.workspace.id.startsWith("__synthetic_")

  return (
    <div className="space-y-3">
      <WorkspaceSectionHeader
        canManageWorkspace={canManageWorkspace}
        onCreateRepoWorkspace={props.onCreateRepoWorkspace}
        onDeleteWorkspace={props.onDeleteWorkspace}
        onEditWorkspace={props.onEditWorkspace}
        section={props.section}
      />
      <WorkspaceSectionRepoList
        {...props}
        canManageWorkspace={canManageWorkspace}
      />
    </div>
  )
}

const useNeonBackend =
  process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND === "neon"

interface Props {
  onOpenChat: (repo: Repo) => void
  onReposLoaded?: (repos: Repo[], agents: Agent[]) => void
}

type GithubSetupState = ReturnType<typeof presentGithubSetup>

type WorkspaceSection = {
  workspace: Workspace
  repos: Repo[]
}

function RepoDashboardStatsPills({
  installationCount,
  syncedRepoCount,
}: {
  installationCount: number
  syncedRepoCount: number
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
      <span className="rounded-sm border border-border bg-card px-2 py-0.5">
        {installationCount} installations
      </span>
      <span className="rounded-sm border border-border bg-card px-2 py-0.5">
        {syncedRepoCount} synced spaces
      </span>
    </div>
  )
}

function RepoDashboardFailureState({
  dataLoadError,
  installationCount,
  onRetry,
  syncedRepoCount,
}: {
  dataLoadError: string
  installationCount: number
  onRetry: () => void
  syncedRepoCount: number
}) {
  const { scope } = useParams<{ scope: string }>()
  return (
    <div className="mx-auto flex h-full w-full max-w-lg items-center px-4 py-10">
      <div className="w-full space-y-4">
        <div>
          <div className="text-sm font-medium text-foreground/85">Failed to load projects and spaces.</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {dataLoadError}
          </p>
          <RepoDashboardStatsPills
            installationCount={installationCount}
            syncedRepoCount={syncedRepoCount}
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={onRetry}
            className="h-8 rounded-sm text-xs"
          >
            Retry
          </Button>
          <Button asChild variant="ghost" size="sm" className="h-8 rounded-sm text-xs text-muted-foreground">
            <a href={scopedHref(scope, "/settings")}>Settings</a>
          </Button>
        </div>
      </div>
    </div>
  )
}

function RepoDashboardEmptyActions({
  emptyStateActionLabel,
  emptyStateActionHref,
  emptyStateConnectionMode,
  emptyStateDetail,
  emptyStateTitle,
  installationCount,
  onCreateWorkspace,
  onSyncGithub,
  repoSyncError,
  syncedRepoCount,
  syncingRepos,
}: {
  emptyStateActionLabel: string | null
  emptyStateActionHref: string | null
  emptyStateConnectionMode: "oauth" | "app" | null
  emptyStateDetail: string
  emptyStateTitle: string
  installationCount: number
  onCreateWorkspace: () => void
  onSyncGithub?: () => void
  repoSyncError: string | null
  syncedRepoCount: number
  syncingRepos: boolean
}) {
  const { scope } = useParams<{ scope: string }>()
  return (
    <div className="w-full space-y-4">
      <div>
        <div className="text-sm font-medium text-foreground/85">{emptyStateTitle}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {emptyStateDetail}
        </p>
        <RepoDashboardStatsPills
          installationCount={installationCount}
          syncedRepoCount={syncedRepoCount}
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onCreateWorkspace}
          className="h-8 rounded-sm text-xs"
        >
          New project
        </Button>
        {onSyncGithub ? (
          <Button
            size="sm"
            onClick={onSyncGithub}
            className="h-8 rounded-sm text-xs"
          >
            {syncingRepos ? "Importing..." : "Import repositories"}
          </Button>
        ) : emptyStateActionHref && emptyStateActionLabel ? (
          <Button asChild size="sm" className="h-8 rounded-sm text-xs">
            <a
              href={emptyStateActionHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                if (!emptyStateConnectionMode) {
                  return
                }
                trackActivation("github_connect_started", {
                  source: "repos_empty_state",
                  connection_mode: emptyStateConnectionMode,
                })
              }}
            >
              {emptyStateActionLabel}
            </a>
          </Button>
        ) : null}
        <Button asChild variant="ghost" size="sm" className="h-8 rounded-sm text-xs text-muted-foreground">
          <a href={scopedHref(scope, "/settings")}>Settings</a>
        </Button>
      </div>
      {repoSyncError ? (
        <div className="border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-500">
          {repoSyncError}
        </div>
      ) : null}
    </div>
  )
}

function VercelSetupBlock({
  setup,
  onLinkProject,
}: {
  setup: ReturnType<typeof presentVercelSetup>
  onLinkProject?: () => void
}) {
  const action = setup.primaryAction
  const handleViaCallback =
    action?.kind === "link_project" && onLinkProject

  return (
    <div className="w-full border-t border-border/60 pt-4 space-y-3">
      <div>
        <div className="text-sm font-medium text-foreground/85">
          {setup.label}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{setup.detail}</p>
      </div>
      {action ? (
        <div className="flex gap-2">
          {handleViaCallback ? (
            <Button
              size="sm"
              className="h-8 rounded-sm text-xs"
              onClick={() => {
                trackActivation("vercel_connect_started", {
                  source: "repos_empty_state",
                  action_kind: action.kind,
                })
                onLinkProject()
              }}
            >
              {action.label}
            </Button>
          ) : (
            <Button asChild size="sm" className="h-8 rounded-sm text-xs">
              <a
                href={action.href}
                onClick={() => {
                  trackActivation("vercel_connect_started", {
                    source: "repos_empty_state",
                    action_kind: action.kind,
                  })
                }}
              >
                {action.label}
              </a>
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}

function RepoDashboardEmptyState({
  githubSetup,
  vercelSetup,
  installationCount,
  onCreateWorkspace,
  onSyncGithub,
  repoSyncError,
  syncedRepoCount,
  syncingRepos,
}: {
  githubSetup: GithubSetupState
  vercelSetup: ReturnType<typeof presentVercelSetup>
  installationCount: number
  onCreateWorkspace: () => void
  onSyncGithub?: () => void
  repoSyncError: string | null
  syncedRepoCount: number
  syncingRepos: boolean
}) {
  const emptyState = presentProjectsEmptyState(githubSetup)
  const action = githubSetup.primaryAction
  // canSyncRepos is true in more states than isConnectionReady (OAuth-connected
  // users can still import even with the app install pending). Gate on the
  // broader signal so anyone who can import repos also sees the Vercel block.
  const showVercelBlock =
    githubSetup.canSyncRepos && !vercelSetup.canLaunchSandbox

  return (
    <div className="mx-auto flex h-full w-full max-w-lg items-center px-4 py-10">
      <div className="w-full space-y-6">
        <RepoDashboardEmptyActions
          emptyStateActionHref={action?.href ?? null}
          emptyStateActionLabel={action?.label ?? null}
          emptyStateConnectionMode={
            action ? (action.kind === "connect" ? "oauth" : "app") : null
          }
          emptyStateDetail={emptyState.detail}
          emptyStateTitle={emptyState.title}
          installationCount={installationCount}
          onCreateWorkspace={onCreateWorkspace}
          onSyncGithub={onSyncGithub}
          repoSyncError={repoSyncError}
          syncedRepoCount={syncedRepoCount}
          syncingRepos={syncingRepos}
        />
        {showVercelBlock ? (
          <VercelSetupBlock
            setup={vercelSetup}
            onLinkProject={onCreateWorkspace}
          />
        ) : null}
      </div>
    </div>
  )
}

function RepoDashboardContent({
  activePreviewCount,
  agents,
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
  vercelSetup,
  handleDeleteWorkspace,
  handleLaunchSandbox,
  handleStopSandbox,
  hiddenCount,
  hideByOwner,
  hideRepo,
  isCreatingRepo,
  onOpenChat,
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
  user,
  viewMode,
  visibleRepoCount,
  visibleWorkspaceCount,
  onToggleFavorite,
  workspaceSections,
  workspaces,
}: {
  activePreviewCount: number
  agents: Agent[]
  browsingMonorepo: Repo | null
  connectGithubLabel: string
  creatingRepoWorkspace: Workspace | null
  creatingWorkspace: boolean
  dataLoadError: string | null
  editingRepo: Repo | null
  editingWorkspace: Workspace | null
  fetchData: () => Promise<void>
  filteredReposLength: number
  githubSetup: GithubSetupState
  vercelSetup: ReturnType<typeof presentVercelSetup>
  handleDeleteWorkspace: (workspace: Workspace) => Promise<void>
  handleLaunchSandbox: (repo: Repo, trigger?: string) => Promise<void>
  handleStopSandbox: (repoId: string) => Promise<void>
  hiddenCount: number
  hideByOwner: (owner: string) => Promise<void>
  hideRepo: (repo: Repo) => Promise<void>
  isCreatingRepo: (repoId: string) => boolean
  onOpenChat: (repo: Repo) => void
  ownerFilter: string
  owners: string[]
  repoAgentsMap: Map<string, Agent[]>
  repoCronsMap: Map<string, Assignment[]>
  repoSyncError: string | null
  repos: Repo[]
  restartRepoSandbox: (repo: Repo) => Promise<void>
  saveRepoSettings: (repo: Repo) => Promise<void>
  sandboxes: Record<string, SandboxRecord | null | undefined>
  search: string
  selected: string | null
  setBrowsingMonorepo: (repo: Repo | null) => void
  setCreatingRepoWorkspace: (workspace: Workspace | null) => void
  setCreatingWorkspace: (value: boolean) => void
  setEditingRepo: (repo: Repo | null) => void
  setEditingWorkspace: (workspace: Workspace | null) => void
  setHasAttemptedRepoSync: (value: boolean) => void
  setOwnerFilter: (value: string) => void
  setSearch: (value: string) => void
  setSelected: (value: string | null) => void
  setShowHidden: (updater: (current: boolean) => boolean) => void
  setViewMode: (value: "grid" | "list") => void
  showHidden: boolean
  syncGithubRepos: (source?: string) => Promise<void>
  syncingRepos: boolean
  user: ReturnType<typeof useUser>["user"]
  viewMode: "grid" | "list"
  visibleRepoCount: number
  visibleWorkspaceCount: number
  onToggleFavorite: (repo: Repo) => Promise<void>
  workspaceSections: WorkspaceSection[]
  workspaces: Workspace[]
}) {
  const rootState = getRepoDashboardRootState({
    dataLoadError,
    repoCount: repos.length,
    syncingRepos,
    workspaceCount: workspaces.length,
  })

  switch (rootState) {
    case "failure":
      return (
        <RepoDashboardFailureView
          dataLoadError={dataLoadError}
          fetchData={fetchData}
          user={user}
        />
      )
    case "empty":
      return (
        <RepoDashboardEmptyView
          creatingWorkspace={creatingWorkspace}
          fetchData={fetchData}
          githubSetup={githubSetup}
          vercelSetup={vercelSetup}
          repoSyncError={repoSyncError}
          setCreatingWorkspace={setCreatingWorkspace}
          setHasAttemptedRepoSync={setHasAttemptedRepoSync}
          syncGithubRepos={syncGithubRepos}
          syncingRepos={syncingRepos}
          user={user}
        />
      )
    default:
      return (
        <RepoDashboardMainContent
          activePreviewCount={activePreviewCount}
          agents={agents}
          browsingMonorepo={browsingMonorepo}
          connectGithubLabel={connectGithubLabel}
          creatingRepoWorkspace={creatingRepoWorkspace}
          creatingWorkspace={creatingWorkspace}
          dataLoadError={dataLoadError}
          editingRepo={editingRepo}
          editingWorkspace={editingWorkspace}
          fetchData={fetchData}
          filteredReposLength={filteredReposLength}
          githubSetup={githubSetup}
          handleDeleteWorkspace={handleDeleteWorkspace}
          handleLaunchSandbox={handleLaunchSandbox}
          handleStopSandbox={handleStopSandbox}
          hiddenCount={hiddenCount}
          hideByOwner={hideByOwner}
          hideRepo={hideRepo}
          isCreatingRepo={isCreatingRepo}
          onOpenChat={onOpenChat}
          onToggleFavorite={onToggleFavorite}
          ownerFilter={ownerFilter}
          owners={owners}
          repoAgentsMap={repoAgentsMap}
          repoCronsMap={repoCronsMap}
          repoSyncError={repoSyncError}
          repos={repos}
          restartRepoSandbox={restartRepoSandbox}
          saveRepoSettings={saveRepoSettings}
          sandboxes={sandboxes}
          search={search}
          selected={selected}
          setBrowsingMonorepo={setBrowsingMonorepo}
          setCreatingRepoWorkspace={setCreatingRepoWorkspace}
          setCreatingWorkspace={setCreatingWorkspace}
          setEditingRepo={setEditingRepo}
          setEditingWorkspace={setEditingWorkspace}
          setHasAttemptedRepoSync={setHasAttemptedRepoSync}
          setOwnerFilter={setOwnerFilter}
          setSearch={setSearch}
          setSelected={setSelected}
          setShowHidden={setShowHidden}
          setViewMode={setViewMode}
          showHidden={showHidden}
          syncGithubRepos={syncGithubRepos}
          syncingRepos={syncingRepos}
          viewMode={viewMode}
          visibleRepoCount={visibleRepoCount}
          visibleWorkspaceCount={visibleWorkspaceCount}
          workspaceSections={workspaceSections}
        />
      )
  }
}

function RepoDashboardFailureView({
  dataLoadError,
  fetchData,
  user,
}: {
  dataLoadError: string | null
  fetchData: () => Promise<void>
  user: ReturnType<typeof useUser>["user"]
}) {
  return (
    <RepoDashboardFailureState
      dataLoadError={dataLoadError || "Failed to load projects and spaces"}
      installationCount={user?.github_installation_count ?? 0}
      onRetry={() => void fetchData()}
      syncedRepoCount={user?.github_synced_repo_count ?? 0}
    />
  )
}

function RepoDashboardEmptyView({
  creatingWorkspace,
  fetchData,
  githubSetup,
  vercelSetup,
  repoSyncError,
  setCreatingWorkspace,
  setHasAttemptedRepoSync,
  syncGithubRepos,
  syncingRepos,
  user,
}: {
  creatingWorkspace: boolean
  fetchData: () => Promise<void>
  githubSetup: GithubSetupState
  vercelSetup: ReturnType<typeof presentVercelSetup>
  repoSyncError: string | null
  setCreatingWorkspace: (value: boolean) => void
  setHasAttemptedRepoSync: (value: boolean) => void
  syncGithubRepos: (source?: string) => Promise<void>
  syncingRepos: boolean
  user: ReturnType<typeof useUser>["user"]
}) {
  return (
    <>
      <RepoDashboardEmptyState
        githubSetup={githubSetup}
        vercelSetup={vercelSetup}
        installationCount={user?.github_installation_count ?? 0}
        onCreateWorkspace={() => setCreatingWorkspace(true)}
        onSyncGithub={getRepoDashboardEmptySyncAction({
          githubSetup,
          setHasAttemptedRepoSync,
          syncGithubRepos,
        })}
        repoSyncError={repoSyncError}
        syncedRepoCount={user?.github_synced_repo_count ?? 0}
        syncingRepos={syncingRepos}
      />
      {creatingWorkspace ? (
        <WorkspaceDialog
          onClose={() => setCreatingWorkspace(false)}
          onSaved={() => void fetchData()}
        />
      ) : null}
    </>
  )
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
  Parameters<typeof RepoDashboardContent>[0],
  "user" | "workspaces" | "vercelSetup"
>) {
  // vercelSetup is intentionally not consumed here — the Vercel onboarding
  // block only renders from the empty-state path. Omitting it keeps this
  // component's prop surface focused.
  const showNoResults = workspaceSections.length === 0 && (repos.length > 0 || filteredReposLength > 0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
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
          setHasAttemptedRepoSync(true)
          void syncGithubRepos("repo_dashboard_toolbar")
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
          <div className="py-12 text-center text-xs text-muted-foreground">
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
  )
}

function getRepoDashboardRootState({
  dataLoadError,
  repoCount,
  syncingRepos,
  workspaceCount,
}: {
  dataLoadError: string | null
  repoCount: number
  syncingRepos: boolean
  workspaceCount: number
}) {
  if (syncingRepos) {
    return "ready" as const
  }

  if (dataLoadError && workspaceCount === 0 && repoCount === 0) {
    return "failure" as const
  }

  if (workspaceCount === 0 && repoCount === 0) {
    return "empty" as const
  }

  return "ready" as const
}

function getRepoDashboardEmptySyncAction({
  githubSetup,
  setHasAttemptedRepoSync,
  syncGithubRepos,
}: {
  githubSetup: GithubSetupState
  setHasAttemptedRepoSync: (value: boolean) => void
  syncGithubRepos: (source?: string) => Promise<void>
}) {
  if (!githubSetup.canSyncRepos) {
    return undefined
  }

  return () => {
    setHasAttemptedRepoSync(true)
    void syncGithubRepos("repos_empty_state")
  }
}

function buildRepoDashboardSummaryText(input: {
  activePreviewCount: number
  filteredReposLength: number
  hiddenCount: number
  ownerFilter: string
  search: string
  showHidden: boolean
  visibleRepoCount: number
  visibleWorkspaceCount: number
}) {
  const base =
    input.search.trim() || input.ownerFilter !== "all"
      ? `${input.filteredReposLength} matching`
      : `${input.visibleRepoCount} repos · ${input.visibleWorkspaceCount} projects`

  return [
    base,
    input.activePreviewCount > 0 ? `${input.activePreviewCount} live` : null,
    input.hiddenCount > 0 && !input.showHidden ? `${input.hiddenCount} hidden` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

function RepoDashboardViewToggle({
  onSelectView,
  viewMode,
}: {
  onSelectView: (viewMode: "grid" | "list") => void
  viewMode: "grid" | "list"
}) {
  return (
    <div className="flex items-center rounded-sm border border-border bg-card/60">
      <button
        onClick={() => onSelectView("grid")}
        className={cn(
          "px-2.5 py-1.5 text-xs transition-colors",
          viewMode === "grid"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Grid
      </button>
      <button
        onClick={() => onSelectView("list")}
        className={cn(
          "px-2.5 py-1.5 text-xs transition-colors",
          viewMode === "list"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        List
      </button>
    </div>
  )
}

function RepoDashboardSyncAction({
  githubSetup,
  onSyncGithub,
  syncingRepos,
}: {
  githubSetup: GithubSetupState
  onSyncGithub: () => void
  syncingRepos: boolean
}) {
  if (githubSetup.canSyncRepos) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onSyncGithub}
        disabled={syncingRepos}
        className="h-8 rounded-sm text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {syncingRepos ? "Syncing..." : "Sync GitHub"}
      </Button>
    )
  }

  if (!githubSetup.primaryAction) {
    return null
  }

  return (
    <Button asChild variant="ghost" size="sm" className="h-8 rounded-sm text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
      <a
        href={githubSetup.primaryAction.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() =>
          trackActivation("github_connect_started", {
            source: "repo_dashboard_toolbar",
            connection_mode:
              githubSetup.primaryAction?.kind === "connect" ? "oauth" : "app",
          })
        }
      >
        {githubSetup.primaryAction.label}
      </a>
    </Button>
  )
}

function RepoDashboardHeader({
  activePreviewCount,
  filteredReposLength,
  githubSetup,
  hiddenCount,
  onCreateWorkspace,
  onHideByOwner,
  onSearchChange,
  onSelectOwner,
  onSelectView,
  onSyncGithub,
  onToggleShowHidden,
  ownerFilter,
  owners,
  search,
  showHidden,
  syncingRepos,
  viewMode,
  visibleRepoCount,
  visibleWorkspaceCount,
}: {
  activePreviewCount: number
  filteredReposLength: number
  githubSetup: GithubSetupState
  hiddenCount: number
  onCreateWorkspace: () => void
  onHideByOwner: () => void
  onSearchChange: (value: string) => void
  onSelectOwner: (value: string) => void
  onSelectView: (viewMode: "grid" | "list") => void
  onSyncGithub: () => void
  onToggleShowHidden: () => void
  ownerFilter: string
  owners: string[]
  search: string
  showHidden: boolean
  syncingRepos: boolean
  viewMode: "grid" | "list"
  visibleRepoCount: number
  visibleWorkspaceCount: number
}) {
  const { scope } = useParams<{ scope: string }>()
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <h1 className="text-sm font-medium text-foreground/85">Projects</h1>
          <span className="text-xs text-muted-foreground">
            {buildRepoDashboardSummaryText({
              activePreviewCount,
              filteredReposLength,
              hiddenCount,
              ownerFilter,
              search,
              showHidden,
              visibleRepoCount,
              visibleWorkspaceCount,
            })}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search spaces..."
              className="h-8 w-full rounded-sm border-border bg-card/80 text-xs text-foreground placeholder:text-muted-foreground shadow-none sm:w-56"
            />
            {owners.length > 1 ? (
              <select
                value={ownerFilter}
                onChange={(event) => onSelectOwner(event.target.value)}
                className="h-8 w-full rounded-sm border border-border bg-card/80 px-2 text-xs text-foreground outline-none sm:w-auto"
              >
                <option value="all">All orgs</option>
                {owners.map((owner) => (
                  <option key={owner} value={owner}>{owner}</option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ownerFilter !== "all" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onHideByOwner}
                className="h-8 rounded-sm text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                Remove {ownerFilter}
              </Button>
            ) : null}
            {hiddenCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleShowHidden}
                className="h-8 rounded-sm text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {showHidden ? "Hide removed" : "Show removed"}
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={onCreateWorkspace}
              className="h-8 w-full justify-center rounded-sm text-xs sm:w-auto"
            >
              New project
            </Button>
            <Button asChild variant="ghost" size="sm" className="h-8 rounded-sm text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
              <Link href={scopedHref(scope, "/projects/repositories/sandboxes")}>Manage sandboxes</Link>
            </Button>
            <RepoDashboardSyncAction
              githubSetup={githubSetup}
              onSyncGithub={onSyncGithub}
              syncingRepos={syncingRepos}
            />
            <RepoDashboardViewToggle
              onSelectView={onSelectView}
              viewMode={viewMode}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function RepoDashboardStatusMessages({
  dataLoadError,
  repoSyncError,
  syncingRepos,
}: {
  dataLoadError: string | null
  repoSyncError: string | null
  syncingRepos: boolean
}) {
  return (
    <>
      {dataLoadError ? (
        <div className="mx-4 mt-2 border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-500">
          {dataLoadError}
        </div>
      ) : repoSyncError ? (
        <div className="mx-4 mt-2 border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-500">
          {repoSyncError}
        </div>
      ) : null}

      {syncingRepos ? (
        <div className="px-4 py-2 text-xs text-muted-foreground">Syncing GitHub repositories...</div>
      ) : null}
    </>
  )
}

function RepoDashboardDialogs({
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
  browsingMonorepo: Repo | null
  creatingRepoWorkspace: Workspace | null
  creatingWorkspace: boolean
  editingRepo: Repo | null
  editingWorkspace: Workspace | null
  fetchData: () => Promise<void>
  restartRepoSandbox: (repo: Repo) => Promise<void>
  saveRepoSettings: (repo: Repo) => Promise<void>
  setBrowsingMonorepo: (repo: Repo | null) => void
  setCreatingRepoWorkspace: (workspace: Workspace | null) => void
  setCreatingWorkspace: (value: boolean) => void
  setEditingRepo: (repo: Repo | null) => void
  setEditingWorkspace: (workspace: Workspace | null) => void
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setBrowsingMonorepo(null)}>
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card p-4 sm:p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">{browsingMonorepo.full_name}</div>
                <div className="text-xs text-muted-foreground">Add sub-project repositories from this monorepo</div>
              </div>
              <button onClick={() => setBrowsingMonorepo(null)} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">Close</button>
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
  )
}

export function RepoDashboard({ onOpenChat, onReposLoaded }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [repos, setRepos] = useState<Repo[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [search, setSearch] = useState("")
  const [ownerFilter, setOwnerFilter] = useState<string>("all")
  const [showHidden, setShowHidden] = useState(false)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [selected, setSelected] = useState<string | null>(null)
  const [editingRepo, setEditingRepo] = useState<Repo | null>(null)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [creatingRepoWorkspace, setCreatingRepoWorkspace] = useState<Workspace | null>(null)
  const [browsingMonorepo, setBrowsingMonorepo] = useState<Repo | null>(null)
  const [syncingRepos, setSyncingRepos] = useState(false)
  const [repoSyncError, setRepoSyncError] = useState<string | null>(null)
  const [dataLoadError, setDataLoadError] = useState<string | null>(null)
  const [hasAttemptedRepoSync, setHasAttemptedRepoSync] = useState(false)
  const [hasLoadedInitialRepos, setHasLoadedInitialRepos] = useState(false)

  const sandboxes = useSandboxStore((state) => state.sandboxes)
  const sandboxesById = useSandboxStore((state) => state.sandboxesById)
  const hasCreatingForRepo = useSandboxStore((state) => state.hasCreatingForRepo)
  const refreshSandboxes = useSandboxStore((state) => state.refresh)
  const launchSandbox = useSandboxStore((state) => state.launch)
  const stopSandbox = useSandboxStore((state) => state.stop)
  const getSandboxForRepo = useSandboxStore((state) => state.getSandboxForRepo)
  const { launchRepoSandbox } = useSandboxLaunchActions()
  const { user } = useUser()
  const activeTeamId = useActiveTeamId()
  const githubSetup = presentGithubSetup(user)
  const vercelSetup = presentVercelSetup(user)
  const connectGithubLabel = githubSetup.connectLabel

  const parseRouteError = useCallback(async (response: Response, fallback: string) => {
    try {
      const data = await response.json() as { error?: unknown }
      if (typeof data?.error === "string" && data.error.trim()) {
        return data.error.trim()
      }
    } catch {
      // Ignore parse failures and use the fallback message.
    }

    return fallback
  }, [])

  const fetchWorkspaces = useCallback(async () => {
    const response = await fetch("/api/workspaces", {
      headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
    })
    if (!response.ok) {
      throw new Error(await parseRouteError(response, "Failed to load projects"))
    }
    const data = await response.json()
    return sortWorkspaces(Array.isArray(data) ? data : [])
  }, [activeTeamId, parseRouteError])

  const syncGithubRepos = useCallback(async (source = "repo_dashboard") => {
    setDataLoadError(null)
    setRepoSyncError(null)
    setSyncingRepos(true)
    trackActivation("repo_sync_started", { source })
    try {
      const res = await fetch("/api/github/repos", {
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      })
      const data = await res.json()

      if (res.ok) {
        const syncedRepos = sortRepos(data)
        const nextWorkspaces = await fetchWorkspaces()
        setRepos(syncedRepos)
        setWorkspaces(nextWorkspaces)
        onReposLoaded?.(syncedRepos, agents)
        trackActivation("repo_sync_completed", {
          source,
          repo_count: syncedRepos.length,
        })
        return
      }

      if (data.error === "NO_GITHUB_TOKEN" || data.error === "NO_GITHUB_CONNECTION") {
        setRepoSyncError(
          presentRepoSyncFailure(typeof data.error === "string" ? data.error : null, connectGithubLabel)
        )
        trackActivation("repo_sync_failed", {
          source,
          error_code: data.error,
        })
        return
      }

      setRepoSyncError(presentRepoSyncFailure(typeof data.error === "string" ? data.error : null, connectGithubLabel))
      trackActivation("repo_sync_failed", {
        source,
        error_code: data.error || "unknown_error",
      })
    } catch {
      setRepoSyncError(presentRepoSyncFailure("GITHUB_SYNC_ERROR", connectGithubLabel))
      trackActivation("repo_sync_failed", {
        source,
        error_code: "network_error",
      })
    } finally {
      setSyncingRepos(false)
    }
  }, [activeTeamId, connectGithubLabel, agents, fetchWorkspaces, onReposLoaded])

  const fetchData = useCallback(async () => {
    setDataLoadError(null)
    const repoUrl = showHidden ? "/api/repos?show_hidden=true" : "/api/repos"

    try {
      const [workspaceResponse, repoResponse, agentResponse, assignmentResponse] = await Promise.all([
        fetchWorkspaces(),
        fetch(repoUrl, {
          headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
        }).then(async (res) => {
          if (!res.ok) {
            throw new Error(await parseRouteError(res, "Failed to load repositories"))
          }
          return res.json()
        }),
        fetch("/api/agents").then((res) => (res.ok ? res.json() : [])),
        fetch("/api/assignments").then((res) => (res.ok ? res.json() : [])),
      ])
      const sorted = sortRepos(repoResponse)
      setWorkspaces(workspaceResponse)
      setRepos(sorted)
      setAgents(agentResponse)
      setAssignments(assignmentResponse)
      setHasLoadedInitialRepos(true)
      onReposLoaded?.(sorted, agentResponse)
    } catch (error) {
      setWorkspaces([])
      setRepos([])
      setAgents([])
      setAssignments([])
      setDataLoadError((error as Error).message || "Failed to load projects and spaces")
    }
  }, [activeTeamId, fetchWorkspaces, onReposLoaded, parseRouteError, showHidden])

  useEffect(() => {
    void fetchData()
    void refreshSandboxes()
  }, [fetchData, refreshSandboxes])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const githubConnected = params.get("github") === "connected"
    const repoSyncFailed = params.get("repo_sync") === "failed"

    if (!githubConnected && !repoSyncFailed) return

    if (repoSyncFailed) {
      setRepoSyncError(presentRepoSyncFailure("GITHUB_SYNC_ERROR", connectGithubLabel))
    }
    if (githubConnected) {
      setHasAttemptedRepoSync(true)
      void syncGithubRepos("repo_dashboard_post_connect")
    }

    params.delete("github")
    params.delete("repo_sync")
    const nextQuery = params.toString()
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`
    window.history.replaceState({}, "", nextUrl)
  }, [connectGithubLabel, syncGithubRepos])

  useEffect(() => {
    if (!hasLoadedInitialRepos || dataLoadError || !githubSetup.canSyncRepos || hasAttemptedRepoSync) return
    setHasAttemptedRepoSync(true)
    void syncGithubRepos("repo_dashboard_auto")
  }, [dataLoadError, githubSetup.canSyncRepos, hasAttemptedRepoSync, syncGithubRepos, hasLoadedInitialRepos])

  // Neon path: SSE-based table events (must call hook unconditionally)
  useTableEvents({
    tables: ["repos"],
    enabled: useNeonBackend && Boolean(user?.id),
    onEvent: () => {
      void fetchData()
    },
  })

  // Supabase path: postgres_changes subscription
  useEffect(() => {
    if (useNeonBackend || !user?.id) return

    const supabase = createSupabaseClient()
    const channel = supabase
      .channel(`repos:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "repos",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void fetchData()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user?.id, fetchData])

  const toggleFavorite = async (repo: Repo) => {
    const res = await fetch("/api/repos", {
      method: "PATCH",
      headers: getActiveTeamRequestHeaders(
        { "Content-Type": "application/json" },
        activeTeamId
      ),
      body: JSON.stringify({ id: repo.id, is_favorite: !repo.is_favorite }),
    })
    const data = await res.json()
    if (res.ok) {
      setRepos((current) => {
        const updated = sortRepos(current.map((item) => (item.id === data.id ? data : item)))
        onReposLoaded?.(updated, agents)
        return updated
      })
    }
  }

  const hideRepo = async (repo: Repo) => {
    const res = await fetch("/api/repos", {
      method: "PATCH",
      headers: getActiveTeamRequestHeaders(
        { "Content-Type": "application/json" },
        activeTeamId
      ),
      body: JSON.stringify({ id: repo.id, is_hidden: !repo.is_hidden }),
    })
    if (res.ok) {
      toast({ title: repo.is_hidden ? "Repository restored" : "Repository removed", description: repo.full_name })
      void fetchData()
    }
  }

  const hideByOwner = async (owner: string) => {
    const ownerRepos = repos.filter((repo) => getRepoOwner(repo) === owner && !repo.is_hidden)
    if (ownerRepos.length === 0) return
    await Promise.all(ownerRepos.map((repo) =>
      fetch("/api/repos", {
        method: "PATCH",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          activeTeamId
        ),
        body: JSON.stringify({ id: repo.id, is_hidden: true }),
      })
    ))
    toast({ title: `Removed ${ownerRepos.length} repositories`, description: owner })
    void fetchData()
  }

  const saveRepoSettings = async (repo: Repo) => {
    const res = await fetch("/api/repos", {
      method: "PATCH",
      headers: getActiveTeamRequestHeaders(
        { "Content-Type": "application/json" },
        activeTeamId
      ),
      body: JSON.stringify({
        id: repo.id,
        default_branch: repo.default_branch,
        vercel_team_id: repo.vercel_team_id,
        vercel_project_id: repo.vercel_project_id,
        sandbox_billing_target: repo.sandbox_billing_target,
        sandbox_billing_mode_override: repo.sandbox_billing_mode_override,
        env_sync_mode: repo.env_sync_mode,
        root_directory: repo.root_directory,
        install_command: repo.install_command,
        dev_command: repo.dev_command,
        dev_port: repo.dev_port,
        dev_port_auto: repo.dev_port_auto,
        sandbox_timeout_ms: repo.sandbox_timeout_ms,
        sandbox_env_vars: repo.sandbox_env_vars,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Failed to save repo settings")
    setRepos((current) => sortRepos(current.map((item) => (item.id === data.id ? data : item))))
    toast({ title: "Settings saved", description: repo.full_name })
  }

  const restartRepoSandbox = async (repo: Repo) => {
    await saveRepoSettings(repo)
    const previousSandbox = getSandboxForRepo(repo.id)
    if (previousSandbox) await stopSandbox(previousSandbox.id)
    bindSessionToPendingSandboxBranch(
      useSessionsStore.getState().activeSessionId,
      previousSandbox?.working_branch ?? null,
    )

    let launched: SandboxRecord | null | undefined
    if (previousSandbox) {
      launched = await launchSandbox(repo.id, {
        repoId: repo.id,
        baseBranch: previousSandbox.base_branch,
        workingBranch: previousSandbox.working_branch,
        createBranch: false,
      })
    } else {
      await launchRepoSandbox(repo, {
        source: "repo_dashboard",
        trigger: "settings_restart",
        intent: { kind: "start_fresh", interactive: false },
      })
      launched = useSandboxStore.getState().getSandboxForRepo(repo.id)
    }

    if (launched?.id) {
      ensureSessionSandboxBinding(
        useSessionsStore.getState().activeSessionId,
        previousSandbox?.id ?? null,
        launched.id,
      )
    }
  }

  const handleLaunchSandbox = async (repo: Repo, trigger = "start_preview_button") => {
    try {
      const previousSandbox = getSandboxForRepo(repo.id)
      const outcome = await launchRepoSandbox(repo, {
        source: "repo_dashboard",
        trigger,
        intent: { kind: "start_fresh" },
      })
      if (outcome.status === "launched") {
        toast({ title: "Sandbox launching" })
        const launched = useSandboxStore.getState().getSandboxForRepo(repo.id)
        if (launched?.id) {
          ensureSessionSandboxBinding(
            useSessionsStore.getState().activeSessionId,
            previousSandbox?.id ?? null,
            launched.id,
          )
        }
      }
    } catch (error) {
      toast({ title: "Sandbox failed", description: (error as Error).message, variant: "destructive" })
    }
  }

  const handleStopSandbox = async (repoId: string) => {
    const sandbox = getSandboxForRepo(repoId)
    if (!sandbox) return
    try {
      await stopSandbox(sandbox.id)
      toast({ title: "Sandbox stopped" })
    } catch (error) {
      toast({ title: "Stop failed", description: (error as Error).message, variant: "destructive" })
    }
  }

  const handleDeleteWorkspace = async (workspace: Workspace) => {
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "DELETE",
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete project")
      }
      toast({ title: "Project deleted", description: workspace.name })
      await fetchData()
    } catch (error) {
      toast({ title: "Delete failed", description: (error as Error).message, variant: "destructive" })
    }
  }

  const owners = useMemo(() => {
    const values = new Set<string>()
    for (const repo of repos) {
      values.add(getRepoOwner(repo))
    }
    return [...values].sort()
  }, [repos])

  const hiddenCount = useMemo(() => repos.filter((repo) => repo.is_hidden).length, [repos])

  const filteredRepos = useMemo(() => {
    let result = repos
    if (!showHidden) {
      result = result.filter((repo) => !repo.is_hidden)
    }
    if (ownerFilter !== "all") {
      result = result.filter((repo) => getRepoOwner(repo) === ownerFilter)
    }
    return filterRepos(result, search)
  }, [search, repos, ownerFilter, showHidden])

  const repoAgentsMap = useMemo(() => {
    const map = new Map<string, Agent[]>()
    for (const assignment of assignments) {
      const agent = agents.find((item) => item.id === assignment.agent_id)
      if (!agent) continue
      const existing = map.get(assignment.repo_id) || []
      existing.push(agent)
      map.set(assignment.repo_id, existing)
    }
    return map
  }, [assignments, agents])

  const repoCronsMap = useMemo(() => {
    const map = new Map<string, Assignment[]>()
    for (const assignment of assignments) {
      if (assignment.type !== "cron_refactor" && assignment.type !== "cron") continue
      const existing = map.get(assignment.repo_id) || []
      existing.push(assignment)
      map.set(assignment.repo_id, existing)
    }
    return map
  }, [assignments])

  const activePreviewCount = useMemo(
    () =>
      Object.values(sandboxesById).filter((sandbox) =>
        isSandboxUiReachablePreview(
          resolveSandboxUiState({ session: null, record: sandbox })
        )
      ).length,
    [sandboxesById],
  )

  const visibleRepoCount = useMemo(
    () => repos.filter((repo) => !repo.is_hidden).length,
    [repos],
  )

  const workspaceSections = useMemo(() => {
    const sections = new Map<string, WorkspaceSection>()
    for (const workspace of workspaces) {
      sections.set(workspace.id, { workspace, repos: [] })
    }

    for (const repo of filteredRepos) {
      const workspaceId = repo.workspace_id && sections.has(repo.workspace_id)
        ? repo.workspace_id
        : "__synthetic_imported__"
      if (!sections.has(workspaceId)) {
        sections.set(workspaceId, {
          workspace: {
            id: workspaceId,
            user_id: repo.user_id,
            name: "Imported Repos",
            description: "Fallback bucket for repos without a loaded project.",
            is_default: true,
            repo_count: 0,
            created_at: repo.created_at,
            updated_at: repo.created_at,
          },
          repos: [],
        })
      }
      sections.get(workspaceId)?.repos.push(repo)
    }

    const showEmptyProjects = !search.trim() && ownerFilter === "all"
    return [...sections.values()]
      .filter((section) => section.repos.length > 0 || showEmptyProjects)
      .sort((a, b) => {
        const defaultOrder = Number(Boolean(b.workspace.is_default)) - Number(Boolean(a.workspace.is_default))
        if (defaultOrder !== 0) return defaultOrder
        return a.workspace.name.localeCompare(b.workspace.name)
      })
  }, [filteredRepos, ownerFilter, search, workspaces])

  const visibleWorkspaceCount = workspaceSections.length

  return (
    <RepoDashboardContent
      activePreviewCount={activePreviewCount}
      agents={agents}
      browsingMonorepo={browsingMonorepo}
      connectGithubLabel={connectGithubLabel}
      creatingRepoWorkspace={creatingRepoWorkspace}
      creatingWorkspace={creatingWorkspace}
      dataLoadError={dataLoadError}
      editingRepo={editingRepo}
      editingWorkspace={editingWorkspace}
      fetchData={fetchData}
      filteredReposLength={filteredRepos.length}
      githubSetup={githubSetup}
      vercelSetup={vercelSetup}
      handleDeleteWorkspace={handleDeleteWorkspace}
      handleLaunchSandbox={handleLaunchSandbox}
      handleStopSandbox={handleStopSandbox}
      hiddenCount={hiddenCount}
      hideByOwner={hideByOwner}
      hideRepo={hideRepo}
      isCreatingRepo={hasCreatingForRepo}
      onOpenChat={onOpenChat}
      onToggleFavorite={toggleFavorite}
      ownerFilter={ownerFilter}
      owners={owners}
      repoAgentsMap={repoAgentsMap}
      repoCronsMap={repoCronsMap}
      repoSyncError={repoSyncError}
      repos={repos}
      restartRepoSandbox={restartRepoSandbox}
      saveRepoSettings={saveRepoSettings}
      sandboxes={sandboxes}
      search={search}
      selected={selected}
      setBrowsingMonorepo={setBrowsingMonorepo}
      setCreatingRepoWorkspace={setCreatingRepoWorkspace}
      setCreatingWorkspace={setCreatingWorkspace}
      setEditingRepo={setEditingRepo}
      setEditingWorkspace={setEditingWorkspace}
      setHasAttemptedRepoSync={setHasAttemptedRepoSync}
      setOwnerFilter={setOwnerFilter}
      setSearch={setSearch}
      setSelected={setSelected}
      setShowHidden={setShowHidden}
      setViewMode={setViewMode}
      showHidden={showHidden}
      syncGithubRepos={syncGithubRepos}
      syncingRepos={syncingRepos}
      user={user}
      viewMode={viewMode}
      visibleRepoCount={visibleRepoCount}
      visibleWorkspaceCount={visibleWorkspaceCount}
      workspaceSections={workspaceSections}
      workspaces={workspaces}
    />
  )
}

function SandboxStatusBadge({
  sandbox,
  isCreating,
}: {
  sandbox?: SandboxRecord | null
  isCreating: boolean
}) {
  const sandboxUiState = resolveSandboxUiState({
    session: null,
    record: sandbox ?? null,
  })

  if (isCreating || isSandboxUiBooting(sandboxUiState)) {
    return (
      <RepoPill dotClassName="bg-amber-300">
        {getSandboxCreationLabel(getSandboxUiRuntimeStatus(sandboxUiState))}
      </RepoPill>
    )
  }
  if (isSandboxUiIdleWarning(sandboxUiState)) {
    return <RepoPill dotClassName="bg-emerald-300">Ready</RepoPill>
  }
  if (sandboxUiState.kind === "degraded" && sandboxUiState.reason === "app_error") {
    return renderSandboxErrorPill(
      "App error",
      getSandboxErrorMessage(
        sandbox?.error_summary.display_error ?? null,
        "The dev server returned an error"
      )
    )
  }
  if (sandboxUiState.kind === "degraded" && sandboxUiState.reason === "unreachable") {
    return <RepoPill dotClassName="bg-amber-300">Unreachable</RepoPill>
  }
  if (isSandboxUiRuntimeRunning(sandboxUiState)) return <RepoPill dotClassName="bg-emerald-300">Ready</RepoPill>
  if (sandboxUiState.kind === "errored") {
    return renderSandboxErrorPill(
      "Error",
      getSandboxErrorMessage(
        sandboxUiState.message,
        "Sandbox failed to start"
      )
    )
  }
  return null
}

function getSandboxCreationLabel(status: string | null | undefined): string {
  return status === "installing" ? "Installing" : "Creating"
}

function getSandboxErrorMessage(
  displayError: string | null | undefined,
  fallback: string
): string {
  return displayError || fallback
}

function renderSandboxErrorPill(label: string, message: string) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span><RepoPill dotClassName="bg-red-300">{label}</RepoPill></span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72 text-xs">
        {message}
      </TooltipContent>
    </Tooltip>
  )
}

interface RepoCardProps {
  repo: Repo
  sandbox: SandboxRecord | null
  isCreating: boolean
  agents: Agent[]
  crons: Assignment[]
  selected: boolean
  viewMode: "grid" | "list"
  onSelect: () => void
  onToggleFavorite: () => void
  onOpenChat: () => void
  onLaunchSandbox: () => void
  onStopSandbox: () => void
  onSettings: () => void
  onBrowseMonorepo?: () => void
  onHide: () => void
}

type RepoCardMenuItemsProps = {
  repo: Repo
  isSandboxRunning: boolean
  isSandboxBusy: boolean
  onOpenChat: () => void
  onLaunchSandbox: () => void
  onStopSandbox: () => void
  onSettings: () => void
  onBrowseMonorepo?: () => void
  onToggleFavorite: () => void
  onHide: () => void
  ItemComponent: React.ComponentType<{
    onSelect?: () => void
    variant?: "default" | "destructive"
    disabled?: boolean
    children: React.ReactNode
  }>
  SeparatorComponent: React.ComponentType
}

function RepoCardMenuItems({
  repo,
  isSandboxRunning,
  isSandboxBusy,
  onOpenChat,
  onLaunchSandbox,
  onStopSandbox,
  onSettings,
  onBrowseMonorepo,
  onToggleFavorite,
  onHide,
  ItemComponent,
  SeparatorComponent,
}: RepoCardMenuItemsProps) {
  const copyCloneUrl = () => {
    void navigator.clipboard.writeText(`git@github.com:${repo.full_name}.git`)
    toast({ title: "Copied clone URL" })
  }

  return (
    <>
      <ItemComponent onSelect={onOpenChat}>Open Workspace</ItemComponent>
      {isSandboxRunning ? (
        <ItemComponent variant="destructive" onSelect={onStopSandbox}>
          Stop Preview
        </ItemComponent>
      ) : (
        <ItemComponent onSelect={onLaunchSandbox} disabled={isSandboxBusy}>Start Preview</ItemComponent>
      )}
      <SeparatorComponent />
      <ItemComponent onSelect={onSettings}>Space Settings</ItemComponent>
      {onBrowseMonorepo && !repo.root_directory && (
        <ItemComponent onSelect={onBrowseMonorepo}>Browse Monorepo</ItemComponent>
      )}
      <SeparatorComponent />
      <ItemComponent onSelect={onToggleFavorite}>
        {repo.is_favorite ? "Unfavorite" : "Favorite"}
      </ItemComponent>
      <ItemComponent variant={repo.is_hidden ? "default" : "destructive"} onSelect={onHide}>
        {repo.is_hidden ? "Restore" : "Remove"}
      </ItemComponent>
      <SeparatorComponent />
      <ItemComponent onSelect={() => window.open(`https://github.com/${repo.full_name}`, "_blank")}>
        Open in GitHub
      </ItemComponent>
      <ItemComponent onSelect={copyCloneUrl}>Copy clone URL</ItemComponent>
    </>
  )
}

function RepoCardCoverageBadge({
  coverageDetail,
  coverageDot,
  coverageLabel,
  coverageTone,
}: {
  coverageDetail: string | null | undefined
  coverageDot: string
  coverageLabel: string | null | undefined
  coverageTone: string
}) {
  if (!coverageLabel) {
    return null
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <RepoPill className={coverageTone} dotClassName={coverageDot}>
            {coverageLabel}
          </RepoPill>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72 text-xs">
        {coverageDetail}
      </TooltipContent>
    </Tooltip>
  )
}

function RepoCardHeader({
  coverageDot,
  coverageTone,
  isCreating,
  isMobile,
  menuProps,
  owner,
  repo,
  repoName,
  sandbox,
}: {
  coverageDot: string
  coverageTone: string
  isCreating: boolean
  isMobile: boolean
  menuProps: Omit<RepoCardMenuItemsProps, "ItemComponent" | "SeparatorComponent">
  owner: string
  repo: Repo
  repoName: string
  sandbox: SandboxRecord | null
}) {
  return (
    <div className={cn("gap-2", isMobile ? "flex flex-col" : "flex items-center")}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-foreground/90">{repoName}</span>
        {repo.root_directory && (
          <span className="truncate font-mono text-xs text-muted-foreground">:{repo.root_directory.split("/").pop()}</span>
        )}
        <span className="truncate font-mono text-xs text-muted-foreground">{owner}</span>
        {repo.is_favorite && <span className="text-xs text-muted-foreground">★</span>}
      </div>
      <div className={cn("flex items-center gap-2", isMobile ? "w-full flex-wrap" : "ml-auto shrink-0")}>
        <RepoCardCoverageBadge
          coverageDetail={repo.github_coverage_detail}
          coverageDot={coverageDot}
          coverageLabel={repo.github_coverage_label}
          coverageTone={coverageTone}
        />
        <SandboxStatusBadge sandbox={sandbox} isCreating={isCreating} />
        <div className={cn(isMobile && "ml-auto")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(event) => event.stopPropagation()}
                aria-label="Repo actions"
                className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MoreHoriz className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <RepoCardMenuItems
                {...menuProps}
                ItemComponent={DropdownMenuItem}
                SeparatorComponent={DropdownMenuSeparator}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

function RepoCardMetadata({
  agents,
  crons,
  metaChips,
  repo,
  sandboxUiState,
}: {
  agents: Agent[]
  crons: Assignment[]
  metaChips: string[]
  repo: Repo
  sandboxUiState: SandboxUiState
}) {
  const previewUrl = getSandboxUiPreviewUrl(sandboxUiState)
  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {metaChips.map((chip) => (
          <span key={chip} className="text-[11px] text-muted-foreground">{chip}</span>
        ))}
        {metaChips.length > 0 && (agents.length > 0 || crons.length > 0) && (
          <span className="text-border">·</span>
        )}
        {agents.map((agent) => (
          <RepoPill key={agent.id}>{agent.name}</RepoPill>
        ))}
        {crons.map((cron) => (
          <RepoPill key={cron.id} className="font-mono">{cron.cron_schedule}</RepoPill>
        ))}
      </div>

      {previewUrl && isSandboxUiReachablePreview(sandboxUiState) && (
        <span className="mt-2 inline-block max-w-full truncate font-mono text-[11px] text-muted-foreground">
          {previewUrl}
        </span>
      )}
      {repo.github_access_state === "synced_only" && (
        <div className="mt-2 text-[11px] text-amber-300/70">
          {repo.github_coverage_detail}
        </div>
      )}
    </>
  )
}

function RepoCardActions({
  isMobile,
  isSandboxBusy,
  isSandboxRunning,
  onOpenChat,
  onStopSandbox,
  sandboxStatus,
  viewMode,
}: {
  isMobile: boolean
  isSandboxBusy: boolean
  isSandboxRunning: boolean
  onOpenChat: () => void
  onStopSandbox: () => void
  sandboxStatus: string | null | undefined
  viewMode: "grid" | "list"
}) {
  return (
    <div
      className={cn(
        "flex gap-1.5",
        isMobile
          ? "w-full flex-col"
          : viewMode === "list"
            ? "shrink-0"
            : "mt-auto",
      )}
    >
      <Button
        size="sm"
        variant="secondary"
        onClick={(event) => {
          event.stopPropagation()
          onOpenChat()
        }}
        className={cn("h-7 rounded-sm px-3 text-xs", isMobile && "w-full justify-center")}
      >
        Open Workspace
      </Button>

      {isSandboxRunning ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation()
            onStopSandbox()
          }}
          className={cn(
            "h-7 rounded-sm px-3 text-xs text-red-400/70 hover:bg-red-500/10 hover:text-red-300",
            isMobile && "w-full justify-center",
          )}
        >
          Stop
        </Button>
      ) : isSandboxBusy ? (
        <span
          className={cn(
            "flex h-7 items-center px-3 text-xs text-muted-foreground",
            isMobile && "w-full justify-center rounded-sm border border-border bg-secondary/50",
          )}
        >
          {sandboxStatus === "installing" ? "Installing..." : "Starting..."}
        </span>
      ) : null}
    </div>
  )
}

function RepoCardShell({
  cardContent,
  isMobile,
  menuProps,
}: {
  cardContent: React.ReactNode
  isMobile: boolean
  menuProps: Omit<RepoCardMenuItemsProps, "ItemComponent" | "SeparatorComponent">
}) {
  if (isMobile) {
    return cardContent
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {cardContent}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <RepoCardMenuItems
          {...menuProps}
          ItemComponent={ContextMenuItem}
          SeparatorComponent={ContextMenuSeparator}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function getRepoCardMetaChips(repo: Repo, sandbox?: SandboxRecord | null) {
  const defaultBranch = repo.default_branch || "main"
  const displayedBranch = sandbox?.working_branch || defaultBranch

  return [
    displayedBranch === defaultBranch
      ? `${displayedBranch} branch`
      : `${displayedBranch} active branch`,
    repo.dev_port_auto === false ? `preview :${repo.dev_port || 3000}` : "preview auto",
  ]
}

function getRepoCardCoveragePresentation(repo: Repo) {
  if (repo.github_access_state === "app_covered") {
    return {
      coverageDot: "bg-accent-green",
      coverageTone: "border-accent-green/20 bg-accent-green/[0.06] text-accent-green",
    }
  }

  return {
    coverageDot: "bg-amber-300",
    coverageTone: "border-amber-400/20 bg-amber-400/[0.06] text-amber-300",
  }
}

function getRepoCardClassName({
  isMobile,
  repo,
  selected,
  viewMode,
}: {
  isMobile: boolean
  repo: Repo
  selected: boolean
  viewMode: "grid" | "list"
}) {
  return cn(
    "group overflow-hidden border border-border bg-card/70 p-4 transition-colors",
    selected ? "bg-accent/80" : "hover:bg-accent/45",
    repo.is_hidden && "opacity-40",
    viewMode === "list" && !isMobile
      ? "flex items-center gap-4"
      : "flex flex-col gap-3",
  )
}

function RepoCard({
  repo,
  sandbox,
  isCreating,
  agents,
  crons,
  selected,
  viewMode,
  onSelect,
  onToggleFavorite,
  onOpenChat,
  onLaunchSandbox,
  onStopSandbox,
  onSettings,
  onBrowseMonorepo,
  onHide,
}: RepoCardProps) {
  const isMobile = useIsMobile()
  const sandboxUiState = resolveSandboxUiState({
    session: null,
    record: sandbox ?? null,
  })
  const isSandboxRunning = isSandboxUiRuntimeRunning(sandboxUiState)
  const isSandboxBusy = isCreating || isSandboxUiBooting(sandboxUiState)
  const owner = getRepoOwner(repo)
  const repoName = getRepoName(repo)
  const metaChips = getRepoCardMetaChips(repo, sandbox)
  const { coverageDot, coverageTone } = getRepoCardCoveragePresentation(repo)

  const menuProps = {
    repo,
    isSandboxRunning,
    isSandboxBusy,
    onOpenChat,
    onLaunchSandbox,
    onStopSandbox,
    onSettings,
    onBrowseMonorepo,
    onToggleFavorite,
    onHide,
  }

  const cardContent = (
    <div
      onClick={onSelect}
      className={getRepoCardClassName({ isMobile, repo, selected, viewMode })}
    >
      <div className="min-w-0 flex-1">
        <RepoCardHeader
          coverageDot={coverageDot}
          coverageTone={coverageTone}
          isCreating={isCreating}
          isMobile={isMobile}
          menuProps={menuProps}
          owner={owner}
          repo={repo}
          repoName={repoName}
          sandbox={sandbox}
        />
        <RepoCardMetadata
          agents={agents}
          crons={crons}
          metaChips={metaChips}
          repo={repo}
          sandboxUiState={sandboxUiState}
        />
      </div>

      <RepoCardActions
        isMobile={isMobile}
        isSandboxBusy={isSandboxBusy}
        isSandboxRunning={isSandboxRunning}
        onOpenChat={onOpenChat}
        onStopSandbox={onStopSandbox}
        sandboxStatus={getSandboxUiRuntimeStatus(sandboxUiState)}
        viewMode={viewMode}
      />
    </div>
  )

  return <RepoCardShell cardContent={cardContent} isMobile={isMobile} menuProps={menuProps} />
}
