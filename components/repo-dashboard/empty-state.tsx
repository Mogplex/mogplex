"use client";

import { useParams } from "next/navigation";
import { scopedHref } from "@/lib/scoped-href";
import { Button } from "@/components/ui/button";
import { trackActivation } from "@/lib/activation-tracking";
import {
  presentProjectsEmptyState,
  presentVercelSetup,
} from "@/lib/activation/setup-state";
import { useUser } from "@/hooks/use-user";
import { WorkspaceDialog } from "@/components/workspace-dialog";
import { getRepoDashboardEmptySyncAction } from "./helpers";
import type { GithubSetupState, VercelSetupState } from "./types";

function RepoDashboardStatsPills({
  installationCount,
  syncedRepoCount,
}: {
  installationCount: number;
  syncedRepoCount: number;
}) {
  return (
    <div className="text-muted-foreground mt-2 flex flex-wrap gap-2 text-[11px]">
      <span className="border-border bg-card rounded-lg border px-2 py-0.5">
        {installationCount} installations
      </span>
      <span className="border-border bg-card rounded-lg border px-2 py-0.5">
        {syncedRepoCount} synced spaces
      </span>
    </div>
  );
}

export function RepoDashboardFailureState({
  dataLoadError,
  installationCount,
  onRetry,
  syncedRepoCount,
}: {
  dataLoadError: string;
  installationCount: number;
  onRetry: () => void;
  syncedRepoCount: number;
}) {
  const { scope } = useParams<{ scope: string }>();
  return (
    <div className="mx-auto flex h-full w-full max-w-lg items-center px-4 py-10">
      <div className="w-full space-y-4">
        <div>
          <div className="text-foreground/85 text-sm font-medium">
            Failed to load projects and spaces.
          </div>
          <p className="text-muted-foreground mt-1 text-xs">{dataLoadError}</p>
          <RepoDashboardStatsPills
            installationCount={installationCount}
            syncedRepoCount={syncedRepoCount}
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={onRetry}
            className="h-8 rounded-lg text-xs"
          >
            Retry
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-8 rounded-lg text-xs"
          >
            <a href={scopedHref(scope, "/settings")}>Settings</a>
          </Button>
        </div>
      </div>
    </div>
  );
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
  emptyStateActionLabel: string | null;
  emptyStateActionHref: string | null;
  emptyStateConnectionMode: "oauth" | "app" | null;
  emptyStateDetail: string;
  emptyStateTitle: string;
  installationCount: number;
  onCreateWorkspace: () => void;
  onSyncGithub?: () => void;
  repoSyncError: string | null;
  syncedRepoCount: number;
  syncingRepos: boolean;
}) {
  const { scope } = useParams<{ scope: string }>();
  return (
    <div className="w-full space-y-4">
      <div>
        <div className="text-foreground/85 text-sm font-medium">
          {emptyStateTitle}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">{emptyStateDetail}</p>
        <RepoDashboardStatsPills
          installationCount={installationCount}
          syncedRepoCount={syncedRepoCount}
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onCreateWorkspace}
          className="h-8 rounded-lg text-xs"
        >
          New project
        </Button>
        {onSyncGithub ? (
          <Button
            size="sm"
            onClick={onSyncGithub}
            className="h-8 rounded-lg text-xs"
          >
            {syncingRepos ? "Importing..." : "Import repositories"}
          </Button>
        ) : emptyStateActionHref && emptyStateActionLabel ? (
          <Button asChild size="sm" className="h-8 rounded-lg text-xs">
            <a
              href={emptyStateActionHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                if (!emptyStateConnectionMode) {
                  return;
                }
                trackActivation("github_connect_started", {
                  source: "repos_empty_state",
                  connection_mode: emptyStateConnectionMode,
                });
              }}
            >
              {emptyStateActionLabel}
            </a>
          </Button>
        ) : null}
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-8 rounded-lg text-xs"
        >
          <a href={scopedHref(scope, "/settings")}>Settings</a>
        </Button>
      </div>
      {repoSyncError ? (
        <div className="border-destructive/20 bg-destructive/[0.08] text-destructive border px-3 py-2 text-xs">
          {repoSyncError}
        </div>
      ) : null}
    </div>
  );
}

function VercelSetupBlock({
  setup,
  onLinkProject,
}: {
  setup: ReturnType<typeof presentVercelSetup>;
  onLinkProject?: () => void;
}) {
  const action = setup.primaryAction;
  const handleViaCallback = action?.kind === "link_project" && onLinkProject;

  return (
    <div className="border-border/60 w-full space-y-3 border-t pt-4">
      <div>
        <div className="text-foreground/85 text-sm font-medium">
          {setup.label}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">{setup.detail}</p>
      </div>
      {action ? (
        <div className="flex gap-2">
          {handleViaCallback ? (
            <Button
              size="sm"
              className="h-8 rounded-lg text-xs"
              onClick={() => {
                trackActivation("vercel_connect_started", {
                  source: "repos_empty_state",
                  action_kind: action.kind,
                });
                onLinkProject();
              }}
            >
              {action.label}
            </Button>
          ) : (
            <Button asChild size="sm" className="h-8 rounded-lg text-xs">
              <a
                href={action.href}
                onClick={() => {
                  if (action.kind !== "billing") {
                    trackActivation("vercel_connect_started", {
                      source: "repos_empty_state",
                      action_kind: action.kind,
                    });
                  }
                }}
              >
                {action.label}
              </a>
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
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
  githubSetup: GithubSetupState;
  vercelSetup: VercelSetupState;
  installationCount: number;
  onCreateWorkspace: () => void;
  onSyncGithub?: () => void;
  repoSyncError: string | null;
  syncedRepoCount: number;
  syncingRepos: boolean;
}) {
  const emptyState = presentProjectsEmptyState(githubSetup);
  const action = githubSetup.primaryAction;
  const showVercelBlock =
    githubSetup.canSyncRepos && !vercelSetup.canLaunchSandbox;

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
  );
}

export function RepoDashboardFailureView({
  dataLoadError,
  fetchData,
  user,
}: {
  dataLoadError: string | null;
  fetchData: () => Promise<void>;
  user: ReturnType<typeof useUser>["user"];
}) {
  return (
    <RepoDashboardFailureState
      dataLoadError={dataLoadError || "Failed to load projects and spaces"}
      installationCount={user?.github_installation_count ?? 0}
      onRetry={() => void fetchData()}
      syncedRepoCount={user?.github_synced_repo_count ?? 0}
    />
  );
}

export function RepoDashboardEmptyView({
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
  creatingWorkspace: boolean;
  fetchData: () => Promise<void>;
  githubSetup: GithubSetupState;
  vercelSetup: VercelSetupState;
  repoSyncError: string | null;
  setCreatingWorkspace: (value: boolean) => void;
  setHasAttemptedRepoSync: (value: boolean) => void;
  syncGithubRepos: (source?: string) => Promise<void>;
  syncingRepos: boolean;
  user: ReturnType<typeof useUser>["user"];
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
  );
}
