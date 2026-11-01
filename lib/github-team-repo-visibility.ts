import {
  fetchGithubInstallationRepos,
  hasGithubAppConfig,
} from "@/lib/github-app";
import { listUserGithubInstallations } from "@/lib/github-user-installations";
import { mapGithubRequests } from "@/lib/github-request-concurrency";

/** Team capability checks happen before loading these scoped repository rows. */
export async function filterAuthorizedTeamGithubRepos<
  T extends {
    user_id: string;
    github_installation_id?: number | null;
    github_id?: number | null;
  },
>(repos: T[]): Promise<T[]> {
  if (!hasGithubAppConfig()) return [];
  const attached = await mapGithubRequests(
    [...new Set(repos.map((repo) => repo.user_id))],
    async (userId) => ({
      userId,
      installations: await listUserGithubInstallations(userId),
    })
  );
  const grants = attached.flatMap(({ userId, installations }) =>
    installations
      .filter((installation) =>
        repos.some(
          (repo) =>
            repo.user_id === userId &&
            repo.github_installation_id === installation.installation_id
        )
      )
      .map((installation) => ({
        userId,
        installationId: installation.installation_id,
      }))
  );
  const current = new Map<string, ReadonlySet<number>>(
    await mapGithubRequests(
      grants,
      async (grant) =>
        [
          `${grant.userId}:${grant.installationId}`,
          new Set(
            (await fetchGithubInstallationRepos(grant.installationId)).map(
              (repo) => repo.id
            )
          ),
        ] as const
    )
  );
  return repos.filter((repo) =>
    current
      .get(`${repo.user_id}:${repo.github_installation_id}`)
      ?.has(Number(repo.github_id))
  );
}
