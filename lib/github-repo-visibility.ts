/** App-backed inventory contains only repositories verified in the current grant. */
export function filterVisibleGithubRepos<
  T extends {
    github_installation_id?: number | null;
    github_id?: number | null;
  },
>(
  repos: T[],
  options: {
    preferInstallationCoverage: boolean;
    authorizedGithubRepoIds?: ReadonlySet<number>;
  }
) {
  if (!options.preferInstallationCoverage) return repos;
  return repos.filter(
    (repo) =>
      Number.isFinite(repo.github_installation_id) &&
      (!options.authorizedGithubRepoIds ||
        options.authorizedGithubRepoIds.has(Number(repo.github_id)))
  );
}
