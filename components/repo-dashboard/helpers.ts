import type { Repo, SandboxRecord, Workspace } from "@/lib/types";
import type { GithubSetupState } from "./types";

export function sortRepos(items: Repo[]) {
  return [...items].sort((a, b) => {
    const favoriteOrder =
      Number(Boolean(b.is_favorite)) - Number(Boolean(a.is_favorite));
    if (favoriteOrder !== 0) return favoriteOrder;
    return a.full_name.localeCompare(b.full_name);
  });
}

export function sortWorkspaces(items: Workspace[]) {
  return [...items].sort((a, b) => {
    const defaultOrder =
      Number(Boolean(b.is_default)) - Number(Boolean(a.is_default));
    if (defaultOrder !== 0) return defaultOrder;
    return a.name.localeCompare(b.name);
  });
}

export function getRepoOwner(repo: Repo) {
  return repo.owner || repo.full_name.split("/")[0] || "owner";
}

export function getRepoName(repo: Repo) {
  return repo.name || repo.full_name.split("/")[1] || repo.full_name;
}

export function getRepoDashboardRootState({
  dataLoadError,
  repoCount,
  syncingRepos,
  workspaceCount,
}: {
  dataLoadError: string | null;
  repoCount: number;
  syncingRepos: boolean;
  workspaceCount: number;
}) {
  if (syncingRepos) {
    return "ready" as const;
  }

  if (dataLoadError && workspaceCount === 0 && repoCount === 0) {
    return "failure" as const;
  }

  if (workspaceCount === 0 && repoCount === 0) {
    return "empty" as const;
  }

  return "ready" as const;
}

export function getRepoDashboardEmptySyncAction({
  githubSetup,
  setHasAttemptedRepoSync,
  syncGithubRepos,
}: {
  githubSetup: GithubSetupState;
  setHasAttemptedRepoSync: (value: boolean) => void;
  syncGithubRepos: (source?: string) => Promise<void>;
}) {
  if (!githubSetup.canSyncRepos) {
    return undefined;
  }

  return () => {
    setHasAttemptedRepoSync(true);
    void syncGithubRepos("repos_empty_state");
  };
}

export function buildRepoDashboardSummaryText(input: {
  activePreviewCount: number;
  filteredReposLength: number;
  hiddenCount: number;
  ownerFilter: string;
  search: string;
  showHidden: boolean;
  visibleRepoCount: number;
  visibleWorkspaceCount: number;
}) {
  const base =
    input.search.trim() || input.ownerFilter !== "all"
      ? `${input.filteredReposLength} matching`
      : `${input.visibleRepoCount} repos · ${input.visibleWorkspaceCount} projects`;

  return [
    base,
    input.activePreviewCount > 0 ? `${input.activePreviewCount} live` : null,
    input.hiddenCount > 0 && !input.showHidden
      ? `${input.hiddenCount} hidden`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function getRepoCardMetaChips(
  repo: Repo,
  sandbox?: SandboxRecord | null
) {
  const defaultBranch = repo.default_branch || "main";
  const displayedBranch = sandbox?.working_branch || defaultBranch;

  return [
    displayedBranch === defaultBranch
      ? `${displayedBranch} branch`
      : `${displayedBranch} active branch`,
    repo.dev_port_auto === false
      ? `preview :${repo.dev_port || 3000}`
      : "preview auto",
  ];
}

export function getRepoCardCoveragePresentation(repo: Repo) {
  if (repo.github_access_state === "app_covered") {
    return {
      coverageDot: "bg-accent-green",
      coverageTone:
        "border-accent-green/20 bg-accent-green/[0.06] text-accent-green",
    };
  }

  return {
    coverageDot: "bg-accent-amber",
    coverageTone:
      "border-accent-amber/20 bg-accent-amber/[0.06] text-accent-amber",
  };
}

export function getRepoCardClassName({
  isMobile,
  repo,
  selected,
  viewMode,
}: {
  isMobile: boolean;
  repo: Repo;
  selected: boolean;
  viewMode: "grid" | "list";
}) {
  return [
    "group overflow-hidden rounded-lg border border-border bg-card/70 p-4 transition-colors",
    selected ? "bg-accent/80" : "hover:bg-accent/45",
    repo.is_hidden && "opacity-40",
    viewMode === "list" && !isMobile
      ? "flex items-center gap-4"
      : "flex flex-col gap-3",
  ]
    .filter(Boolean)
    .join(" ");
}

export function getSandboxCreationLabel(
  status: string | null | undefined
): string {
  return status === "installing" ? "Installing" : "Creating";
}

export function getSandboxErrorMessage(
  displayError: string | null | undefined,
  fallback: string
): string {
  return displayError || fallback;
}
