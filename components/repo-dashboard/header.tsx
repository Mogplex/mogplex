"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { scopedHref } from "@/lib/scoped-href";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trackActivation } from "@/lib/activation-tracking";
import { buildRepoDashboardSummaryText } from "./helpers";
import type { GithubSetupState } from "./types";

function RepoDashboardViewToggle({
  onSelectView,
  viewMode,
}: {
  onSelectView: (viewMode: "grid" | "list") => void;
  viewMode: "grid" | "list";
}) {
  return (
    <div className="border-border bg-card/60 flex items-center rounded-lg border">
      <button
        onClick={() => onSelectView("grid")}
        className={cn(
          "px-2.5 py-1.5 text-xs transition-colors",
          viewMode === "grid"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground"
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
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        List
      </button>
    </div>
  );
}

function RepoDashboardSyncAction({
  githubSetup,
  onSyncGithub,
  syncingRepos,
}: {
  githubSetup: GithubSetupState;
  onSyncGithub: () => void;
  syncingRepos: boolean;
}) {
  if (githubSetup.canSyncRepos) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onSyncGithub}
        disabled={syncingRepos}
        className="text-muted-foreground hover:bg-accent hover:text-foreground h-8 rounded-lg text-xs"
      >
        {syncingRepos ? "Syncing..." : "Sync GitHub"}
      </Button>
    );
  }

  if (!githubSetup.primaryAction) {
    return null;
  }

  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:bg-accent hover:text-foreground h-8 rounded-lg text-xs"
    >
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
  );
}

export function RepoDashboardHeader({
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
  activePreviewCount: number;
  filteredReposLength: number;
  githubSetup: GithubSetupState;
  hiddenCount: number;
  onCreateWorkspace: () => void;
  onHideByOwner: () => void;
  onSearchChange: (value: string) => void;
  onSelectOwner: (value: string) => void;
  onSelectView: (viewMode: "grid" | "list") => void;
  onSyncGithub: () => void;
  onToggleShowHidden: () => void;
  ownerFilter: string;
  owners: string[];
  search: string;
  showHidden: boolean;
  syncingRepos: boolean;
  viewMode: "grid" | "list";
  visibleRepoCount: number;
  visibleWorkspaceCount: number;
}) {
  const { scope } = useParams<{ scope: string }>();
  return (
    <div className="border-border border-b px-4 py-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <h1 className="text-foreground/85 text-sm font-medium">Projects</h1>
          <span className="text-muted-foreground text-xs">
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
              className="border-border bg-card/80 text-foreground placeholder:text-muted-foreground h-8 w-full rounded-lg text-xs shadow-none sm:w-56"
            />
            {owners.length > 1 ? (
              <select
                value={ownerFilter}
                onChange={(event) => onSelectOwner(event.target.value)}
                className="border-border bg-card/80 text-foreground h-8 w-full rounded-lg border px-2 text-xs outline-none sm:w-auto"
              >
                <option value="all">All orgs</option>
                {owners.map((owner) => (
                  <option key={owner} value={owner}>
                    {owner}
                  </option>
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
                className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 rounded-lg text-xs"
              >
                Remove {ownerFilter}
              </Button>
            ) : null}
            {hiddenCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleShowHidden}
                className="text-muted-foreground hover:bg-accent hover:text-foreground h-8 rounded-lg text-xs"
              >
                {showHidden ? "Hide removed" : "Show removed"}
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={onCreateWorkspace}
              className="h-8 w-full justify-center rounded-lg text-xs sm:w-auto"
            >
              New project
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:bg-accent hover:text-foreground h-8 rounded-lg text-xs"
            >
              <Link
                href={scopedHref(scope, "/projects/repositories/sandboxes")}
              >
                Manage sandboxes
              </Link>
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
  );
}

export function RepoDashboardStatusMessages({
  dataLoadError,
  repoSyncError,
  syncingRepos,
}: {
  dataLoadError: string | null;
  repoSyncError: string | null;
  syncingRepos: boolean;
}) {
  return (
    <>
      {dataLoadError ? (
        <div className="border-destructive/20 bg-destructive/[0.08] text-destructive mx-4 mt-2 rounded-lg border px-3 py-2 text-xs">
          {dataLoadError}
        </div>
      ) : repoSyncError ? (
        <div className="border-destructive/20 bg-destructive/[0.08] text-destructive mx-4 mt-2 rounded-lg border px-3 py-2 text-xs">
          {repoSyncError}
        </div>
      ) : null}

      {syncingRepos ? (
        <div className="text-muted-foreground px-4 py-2 text-xs">
          Syncing GitHub repositories...
        </div>
      ) : null}
    </>
  );
}
