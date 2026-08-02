import type { Repo } from "@/lib/types";

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function matchesRepoSearch(repo: Repo, query: string) {
  const needle = normalize(query);
  if (!needle) return true;

  const haystack = [
    repo.full_name,
    repo.owner,
    repo.name,
    repo.default_branch,
    repo.root_directory,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

export function filterRepos(repos: Repo[], query: string) {
  return repos.filter((repo) => matchesRepoSearch(repo, query));
}
