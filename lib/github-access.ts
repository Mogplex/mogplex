import {
  createGithubInstallationAccessToken,
  hasGithubAppConfig,
} from "@/lib/github-app";
import { getOAuthToken } from "@/lib/oauth-tokens";
import { getOwnedRepo, getRepoForScope } from "@/lib/repos";
import type { ProductResourceScope } from "@/lib/team-resource-scope";

type RepoGithubAccessRecord = {
  user_id: string;
  github_installation_id?: number | null;
};

type OwnedRepoLoader<T extends RepoGithubAccessRecord> = (
  repoId: string,
  userId: string,
  select: string
) => Promise<T | null>;

type GithubAccessTokenLoader<T extends RepoGithubAccessRecord> = (
  repo: T,
  actorUserId?: string
) => Promise<string | null>;

export async function getGithubAccessTokenForRepo(
  repo: {
    user_id: string;
    github_installation_id?: number | null;
  },
  actorUserId = repo.user_id
) {
  if (repo.github_installation_id && hasGithubAppConfig()) {
    const { token } = await createGithubInstallationAccessToken(
      repo.github_installation_id
    );
    return token;
  }

  return getOAuthToken(actorUserId, "github");
}

export async function getOwnedRepoWithGithubAccessToken<
  T extends RepoGithubAccessRecord,
>(
  repoId: string,
  userId: string,
  options?: {
    select?: string;
    productTeamId?: string | null;
    loadRepo?: OwnedRepoLoader<T>;
    loadGithubAccessToken?: GithubAccessTokenLoader<T>;
  }
): Promise<{ repo: T | null; githubToken: string | null }> {
  const select = options?.select ?? "*";
  const loadRepo: OwnedRepoLoader<T> =
    options?.loadRepo ??
    ((ownedRepoId, ownerUserId, ownedRepoSelect) => {
      if (options?.productTeamId) {
        const scope: ProductResourceScope = {
          kind: "team",
          userId: ownerUserId,
          productTeamId: options.productTeamId,
        };
        return getRepoForScope<T>(ownedRepoId, scope, ownedRepoSelect);
      }
      return getOwnedRepo<T>(ownedRepoId, ownerUserId, ownedRepoSelect);
    });
  const loadGithubAccessToken: GithubAccessTokenLoader<T> =
    options?.loadGithubAccessToken ?? getGithubAccessTokenForRepo;

  const repo = await loadRepo(repoId, userId, select);
  if (!repo) {
    return { repo: null, githubToken: null };
  }

  const githubToken = await loadGithubAccessToken(repo, userId);
  return { repo, githubToken };
}
