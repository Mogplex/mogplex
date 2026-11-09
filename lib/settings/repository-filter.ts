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

/** True when the repository came through a GitHub App installation. */
export function isAppConnected(repo: Pick<Repo, "github_installation_id">) {
  return repo.github_installation_id != null;
}

export type OwnerCoverage = "connected" | "partial" | "none";

const COVERAGE_ORDER: Record<OwnerCoverage, number> = {
  connected: 0,
  partial: 1,
  none: 2,
};

/**
 * Group the visible repositories by owner, keeping their order inside each
 * group. Coverage and `notConnected` come from all of the owner's connected
 * repositories in `all`, not just the visible ones, so a search never changes
 * what an owner is labelled as or what its bulk removal hides. GitHub only
 * sends webhooks (and so PR reviews and automations) for repositories that
 * came through a GitHub App installation; ones imported through OAuth access
 * alone (the legacy sync of every repo the account could see) never trigger
 * them. Fully connected owners come first, then partly, then not connected,
 * each by name.
 */
export function groupRepositoriesByOwner<
  T extends Pick<
    Repo,
    "owner" | "full_name" | "github_installation_id" | "is_hidden"
  >,
>(visible: T[], all: T[]) {
  const groups = new Map<string, T[]>();
  for (const repo of visible) {
    const owner = repoOwner(repo);
    const group = groups.get(owner);
    if (group) group.push(repo);
    else groups.set(owner, [repo]);
  }
  return [...groups.entries()]
    .map(([owner, repos]) => {
      const ownerConnected = all.filter(
        (repo) => !repo.is_hidden && repoOwner(repo) === owner
      );
      const notConnected = ownerConnected.filter(
        (repo) => !isAppConnected(repo)
      );
      const coverage: OwnerCoverage =
        notConnected.length === 0
          ? "connected"
          : notConnected.length === ownerConnected.length
            ? "none"
            : "partial";
      return { owner, repos, coverage, notConnected };
    })
    .sort(
      (a, b) =>
        COVERAGE_ORDER[a.coverage] - COVERAGE_ORDER[b.coverage] ||
        a.owner.localeCompare(b.owner)
    );
}
