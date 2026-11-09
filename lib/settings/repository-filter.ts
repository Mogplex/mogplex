import type { Repo } from "@/lib/types";

/** Owner login for grouping and bulk removal. */
export function repoOwner(repo: Pick<Repo, "owner" | "full_name">) {
  return repo.owner || repo.full_name.split("/")[0] || "owner";
}

/**
 * Split repositories for Settings → Repositories: those matching the owner
 * and search filters, sorted by name, into connected and removed lists.
 * `ownerConnectedCount` counts every connected repository of the selected
 * owner regardless of search, because bulk removal acts on all of them.
 */
export function filterRepositories<
  T extends Pick<Repo, "owner" | "full_name" | "is_hidden">,
>(repos: T[], filters: { owner: string; search: string }) {
  const query = filters.search.trim().toLowerCase();
  const matches = repos
    .filter(
      (repo) => filters.owner === "all" || repoOwner(repo) === filters.owner
    )
    .filter((repo) => repo.full_name.toLowerCase().includes(query))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  return {
    query,
    connected: matches.filter((repo) => !repo.is_hidden),
    removed: matches.filter((repo) => repo.is_hidden),
    removedTotal: repos.filter((repo) => repo.is_hidden).length,
    ownerConnectedCount: repos.filter(
      (repo) => repoOwner(repo) === filters.owner && !repo.is_hidden
    ).length,
  };
}

/**
 * Split Settings' repository inventory by GitHub App coverage, as the repos
 * API reports it (`github_app_covered`, from `deriveRepoGithubCoverage`). On App
 * deployments with an installation (`github_prefer_installation_coverage`)
 * every other surface already hides repositories without an installation
 * (see `visibleScopedRepos`); those came from the legacy OAuth sync of every
 * repository the account could see and never receive webhooks, so Settings
 * lists them apart. OAuth-only deployments keep every repository.
 */
export function splitByAppConnection<
  T extends Pick<
    Repo,
    "github_app_covered" | "github_prefer_installation_coverage"
  >,
>(repos: T[]) {
  if (!repos.some((repo) => repo.github_prefer_installation_coverage)) {
    return { inventory: repos, notConnected: [] as T[] };
  }
  return {
    inventory: repos.filter((repo) => repo.github_app_covered),
    notConnected: repos.filter((repo) => !repo.github_app_covered),
  };
}

/**
 * Group repositories by owner the way GitHub lists them: the signed-in
 * account first, then organizations and other owners by name. Order inside
 * each group is kept.
 */
export function groupRepositoriesByOwner<
  T extends Pick<Repo, "owner" | "full_name">,
>(repos: T[], selfLogin?: string | null) {
  const groups = new Map<string, T[]>();
  for (const repo of repos) {
    const owner = repoOwner(repo);
    const group = groups.get(owner);
    if (group) group.push(repo);
    else groups.set(owner, [repo]);
  }
  const self = selfLogin?.toLowerCase();
  return [...groups.entries()]
    .map(([owner, ownerRepos]) => ({ owner, repos: ownerRepos }))
    .sort(
      (a, b) =>
        Number(b.owner.toLowerCase() === self) -
          Number(a.owner.toLowerCase() === self) ||
        a.owner.localeCompare(b.owner)
    );
}
