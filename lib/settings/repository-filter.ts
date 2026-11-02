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
