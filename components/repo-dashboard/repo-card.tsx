"use client";

import type { Agent, Assignment, Repo, SandboxRecord } from "@/lib/types";
import {
  getSandboxUiPreviewUrl,
  getSandboxUiRuntimeStatus,
  isSandboxUiBooting,
  isSandboxUiReachablePreview,
  isSandboxUiRuntimeRunning,
  resolveSandboxUiState,
  type SandboxUiState,
} from "@/lib/sandbox/ui-state";
import { cn } from "@/lib/utils";
import { MoreHoriz } from "iconoir-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { RepoPill } from "./repo-pill";
import { SandboxStatusBadge } from "./sandbox-badge";
import {
  getRepoCardClassName,
  getRepoCardCoveragePresentation,
  getRepoCardMetaChips,
  getRepoName,
  getRepoOwner,
} from "./helpers";
import type { RepoCardMenuItemsProps, RepoCardProps } from "./types";

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
    void navigator.clipboard.writeText(`git@github.com:${repo.full_name}.git`);
    toast({ title: "Copied clone URL" });
  };

  return (
    <>
      <ItemComponent onSelect={onOpenChat}>Open Workspace</ItemComponent>
      {isSandboxRunning ? (
        <ItemComponent variant="destructive" onSelect={onStopSandbox}>
          Stop Preview
        </ItemComponent>
      ) : (
        <ItemComponent onSelect={onLaunchSandbox} disabled={isSandboxBusy}>
          Start Preview
        </ItemComponent>
      )}
      <SeparatorComponent />
      <ItemComponent onSelect={onSettings}>Space Settings</ItemComponent>
      {onBrowseMonorepo && !repo.root_directory && (
        <ItemComponent onSelect={onBrowseMonorepo}>
          Browse Monorepo
        </ItemComponent>
      )}
      <SeparatorComponent />
      <ItemComponent onSelect={onToggleFavorite}>
        {repo.is_favorite ? "Unfavorite" : "Favorite"}
      </ItemComponent>
      <ItemComponent
        variant={repo.is_hidden ? "default" : "destructive"}
        onSelect={onHide}
      >
        {repo.is_hidden ? "Restore" : "Remove"}
      </ItemComponent>
      <SeparatorComponent />
      <ItemComponent
        onSelect={() =>
          window.open(`https://github.com/${repo.full_name}`, "_blank")
        }
      >
        Open in GitHub
      </ItemComponent>
      <ItemComponent onSelect={copyCloneUrl}>Copy clone URL</ItemComponent>
    </>
  );
}

function RepoCardCoverageBadge({
  coverageDetail,
  coverageDot,
  coverageLabel,
  coverageTone,
}: {
  coverageDetail: string | null | undefined;
  coverageDot: string;
  coverageLabel: string | null | undefined;
  coverageTone: string;
}) {
  if (!coverageLabel) {
    return null;
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
  );
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
  coverageDot: string;
  coverageTone: string;
  isCreating: boolean;
  isMobile: boolean;
  menuProps: Omit<
    RepoCardMenuItemsProps,
    "ItemComponent" | "SeparatorComponent"
  >;
  owner: string;
  repo: Repo;
  repoName: string;
  sandbox: SandboxRecord | null;
}) {
  return (
    <div
      className={cn("gap-2", isMobile ? "flex flex-col" : "flex items-center")}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-foreground/90 min-w-0 truncate text-sm font-medium">
          {repoName}
        </span>
        {repo.root_directory && (
          <span className="text-muted-foreground truncate font-mono text-xs">
            :{repo.root_directory.split("/").pop()}
          </span>
        )}
        <span className="text-muted-foreground truncate font-mono text-xs">
          {owner}
        </span>
        {repo.is_favorite && (
          <span className="text-muted-foreground text-xs">★</span>
        )}
      </div>
      <div
        className={cn(
          "flex items-center gap-2",
          isMobile ? "w-full flex-wrap" : "ml-auto shrink-0"
        )}
      >
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
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
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
  );
}

function RepoCardMetadata({
  agents,
  crons,
  metaChips,
  repo,
  sandboxUiState,
}: {
  agents: Agent[];
  crons: Assignment[];
  metaChips: string[];
  repo: Repo;
  sandboxUiState: SandboxUiState;
}) {
  const previewUrl = getSandboxUiPreviewUrl(sandboxUiState);
  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {metaChips.map((chip) => (
          <span key={chip} className="text-muted-foreground text-[11px]">
            {chip}
          </span>
        ))}
        {metaChips.length > 0 && (agents.length > 0 || crons.length > 0) && (
          <span className="text-border">·</span>
        )}
        {agents.map((agent) => (
          <RepoPill key={agent.id}>{agent.name}</RepoPill>
        ))}
        {crons.map((cron) => (
          <RepoPill key={cron.id} className="font-mono">
            {cron.cron_schedule}
          </RepoPill>
        ))}
      </div>

      {previewUrl && isSandboxUiReachablePreview(sandboxUiState) && (
        <span className="text-muted-foreground mt-2 inline-block max-w-full truncate font-mono text-[11px]">
          {previewUrl}
        </span>
      )}
      {repo.github_access_state === "synced_only" && (
        <div className="text-accent-amber/80 mt-2 text-[11px]">
          {repo.github_coverage_detail}
        </div>
      )}
    </>
  );
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
  isMobile: boolean;
  isSandboxBusy: boolean;
  isSandboxRunning: boolean;
  onOpenChat: () => void;
  onStopSandbox: () => void;
  sandboxStatus: string | null | undefined;
  viewMode: "grid" | "list";
}) {
  return (
    <div
      className={cn(
        "flex gap-1.5",
        isMobile
          ? "w-full flex-col"
          : viewMode === "list"
            ? "shrink-0"
            : "mt-auto"
      )}
    >
      <Button
        size="sm"
        variant="secondary"
        onClick={(event) => {
          event.stopPropagation();
          onOpenChat();
        }}
        className={cn(
          "h-7 rounded-lg px-3 text-xs",
          isMobile && "w-full justify-center"
        )}
      >
        Open Workspace
      </Button>

      {isSandboxRunning ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
            onStopSandbox();
          }}
          className={cn(
            "text-destructive hover:bg-destructive/10 hover:text-destructive h-7 rounded-lg px-3 text-xs",
            isMobile && "w-full justify-center"
          )}
        >
          Stop
        </Button>
      ) : isSandboxBusy ? (
        <span
          className={cn(
            "text-muted-foreground flex h-7 items-center px-3 text-xs",
            isMobile &&
              "border-border bg-secondary/50 w-full justify-center rounded-lg border"
          )}
        >
          {sandboxStatus === "installing" ? "Installing..." : "Starting..."}
        </span>
      ) : null}
    </div>
  );
}

function RepoCardShell({
  cardContent,
  isMobile,
  menuProps,
}: {
  cardContent: React.ReactNode;
  isMobile: boolean;
  menuProps: Omit<
    RepoCardMenuItemsProps,
    "ItemComponent" | "SeparatorComponent"
  >;
}) {
  if (isMobile) {
    return cardContent;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{cardContent}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <RepoCardMenuItems
          {...menuProps}
          ItemComponent={ContextMenuItem}
          SeparatorComponent={ContextMenuSeparator}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function RepoCard({
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
  const isMobile = useIsMobile();
  const sandboxUiState = resolveSandboxUiState({
    session: null,
    record: sandbox ?? null,
  });
  const isSandboxRunning = isSandboxUiRuntimeRunning(sandboxUiState);
  const isSandboxBusy = isCreating || isSandboxUiBooting(sandboxUiState);
  const owner = getRepoOwner(repo);
  const repoName = getRepoName(repo);
  const metaChips = getRepoCardMetaChips(repo, sandbox);
  const { coverageDot, coverageTone } = getRepoCardCoveragePresentation(repo);

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
  };

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
  );

  return (
    <RepoCardShell
      cardContent={cardContent}
      isMobile={isMobile}
      menuProps={menuProps}
    />
  );
}
