import type { Repo } from "./types";

/** A cached session is not evidence that its repository is still available. */
export function workspaceRepoState(
  repoId: string | null | undefined,
  repos: Pick<Repo, "id" | "is_hidden">[],
  isLoading: boolean,
  error: unknown
): "available" | "loading" | "error" | "removed" | "unavailable" {
  if (!repoId) return "available";
  if (error) return "error";
  if (isLoading) return "loading";
  const repo = repos.find((item) => item.id === repoId);
  if (!repo) return "unavailable";
  return repo.is_hidden ? "removed" : "available";
}

/** Match the collection API's visibility policy while retaining one full cache. */
export function visibleScopedRepos(repos: Repo[], showHidden = false): Repo[] {
  if (showHidden) return repos;
  const visible = repos.filter((repo) => !repo.is_hidden);
  if (!repos.some((repo) => repo.github_prefer_installation_coverage))
    return visible;
  const covered = visible.filter((repo) =>
    Number.isFinite(repo.github_installation_id)
  );
  return covered.length > 0 ? covered : visible;
}
