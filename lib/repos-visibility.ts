import type { Repo } from "./types";

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
