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
 * Group repositories by owner, keeping the incoming order inside each group.
 * `appInstalled` is true when any repository of the owner came through a
 * GitHub App installation: GitHub only sends webhooks (and so PR reviews and
 * automations) for installed owners, while repositories imported through
 * OAuth access alone (legacy sync of every repo the account could see) never
 * trigger them. Installed owners come first, then each half by name.
 */
export function groupRepositoriesByOwner<
  T extends Pick<Repo, "owner" | "full_name" | "github_installation_id">,
>(repos: T[]) {
  const groups = new Map<string, T[]>();
  for (const repo of repos) {
    const owner = repoOwner(repo);
    const group = groups.get(owner);
    if (group) group.push(repo);
    else groups.set(owner, [repo]);
  }
  return [...groups.entries()]
    .map(([owner, ownerRepos]) => ({
      owner,
      repos: ownerRepos,
      appInstalled: ownerRepos.some(
        (repo) => repo.github_installation_id != null
      ),
    }))
    .sort(
      (a, b) =>
        Number(b.appInstalled) - Number(a.appInstalled) ||
        a.owner.localeCompare(b.owner)
    );
}
