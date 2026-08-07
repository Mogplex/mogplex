"use client";

import type { Workspace } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RepoPill } from "./repo-pill";
import { RepoCard } from "./repo-card";
import type {
  GithubSetupState,
  WorkspaceSection,
  WorkspaceSectionPanelProps,
} from "./types";

function WorkspaceSectionHeader({
  canManageWorkspace,
  onCreateRepoWorkspace,
  onDeleteWorkspace,
  onEditWorkspace,
  section,
}: {
  canManageWorkspace: boolean;
  onCreateRepoWorkspace: (workspace: Workspace) => void;
  onDeleteWorkspace: (workspace: Workspace) => void;
  onEditWorkspace: (workspace: Workspace) => void;
  section: WorkspaceSection;
}) {
  return (
    <div className="border-border flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-foreground/90 truncate text-sm font-medium">
            {section.workspace.name}
          </h2>
          {section.workspace.is_default && (
            <RepoPill className="border-border bg-accent/80 text-muted-foreground">
              Imported
            </RepoPill>
          )}
          <span className="text-muted-foreground text-xs">
            {section.repos.length} repo{section.repos.length === 1 ? "" : "s"}
          </span>
        </div>
        {section.workspace.description && (
          <p className="text-muted-foreground mt-1 text-xs">
            {section.workspace.description}
          </p>
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
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-8 rounded-sm px-2 text-xs"
              >
                Manage
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onSelect={() => onEditWorkspace(section.workspace)}
              >
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
  );
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
  canManageWorkspace: boolean;
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
            onBrowseMonorepo={
              !repo.root_directory ? () => onBrowseMonorepo(repo) : undefined
            }
            onHide={() => onHideRepo(repo)}
          />
        ))}
      </div>
    );
  }

  return (
    <WorkspaceSectionEmptyState
      canManageWorkspace={canManageWorkspace}
      connectGithubLabel={connectGithubLabel}
      githubSetup={githubSetup}
      onCreateRepoWorkspace={onCreateRepoWorkspace}
      section={section}
    />
  );
}

function WorkspaceSectionEmptyState({
  canManageWorkspace,
  connectGithubLabel,
  githubSetup,
  onCreateRepoWorkspace,
  section,
}: {
  canManageWorkspace: boolean;
  connectGithubLabel: string;
  githubSetup: GithubSetupState;
  onCreateRepoWorkspace: (workspace: Workspace) => void;
  section: WorkspaceSection;
}) {
  return (
    <div className="border-border bg-card text-muted-foreground rounded-md border px-4 py-5 text-sm">
      <div className="text-foreground/80 font-medium">No repos yet</div>
      <p className="text-muted-foreground mt-1 text-xs">
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
  );
}

export function WorkspaceSectionPanel(props: WorkspaceSectionPanelProps) {
  const canManageWorkspace =
    !props.section.workspace.id.startsWith("__synthetic_");

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
  );
}
