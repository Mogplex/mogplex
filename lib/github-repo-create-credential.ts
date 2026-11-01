import {
  createGithubInstallationAccessToken,
  hasGithubAppConfig,
} from "@/lib/github-app";
import type { GithubRepoOwnerTarget } from "@/lib/github-owners";
import { getGithubOAuthRepositoryToken } from "@/lib/github-repository-auth";
import { getOAuthToken } from "@/lib/oauth-tokens";

export type GithubRepoCreateCredential =
  | { ok: true; token: string }
  | { ok: false; status: 403; code: string; error: string };

const defaultDeps = {
  appConfigured: () => hasGithubAppConfig(),
  getIdentityToken: getOAuthToken,
  getRepositoryToken: getGithubOAuthRepositoryToken,
  createInstallationToken: createGithubInstallationAccessToken,
};

/**
 * The user's own GitHub token, used to list owners and check live org
 * permissions. In an App deployment it is the identity grant, which can read
 * org membership but never writes a repository.
 */
export async function getGithubRepoCreationUserToken(
  userId: string,
  overrides: Partial<typeof defaultDeps> = {}
): Promise<string | null> {
  const deps = { ...defaultDeps, ...overrides };
  return deps.appConfigured()
    ? deps.getIdentityToken(userId, "github")
    : deps.getRepositoryToken(userId);
}

/**
 * Pick the credential that creates the repository. An App deployment creates
 * through the owner's installation, so a repository only appears where the
 * user installed Mogplex. OAuth-only deployments keep the user's repo grant.
 */
export async function resolveGithubRepoCreateCredential(
  target: GithubRepoOwnerTarget,
  userToken: string,
  overrides: Partial<typeof defaultDeps> = {}
): Promise<GithubRepoCreateCredential> {
  const deps = { ...defaultDeps, ...overrides };
  if (!deps.appConfigured()) return { ok: true, token: userToken };
  if (target.kind === "personal") {
    return {
      ok: false,
      status: 403,
      code: "GITHUB_APP_USER_AUTHORIZATION_REQUIRED",
      error:
        "Creating a repository in a personal GitHub account is not available yet. Choose an organization where the Mogplex GitHub App is installed.",
    };
  }
  if (target.github_installation_id == null) {
    return {
      ok: false,
      status: 403,
      code: "GITHUB_APP_INSTALLATION_REQUIRED",
      error: `Install the Mogplex GitHub App on ${target.login} to create repositories there.`,
    };
  }
  const { token } = await deps.createInstallationToken(
    target.github_installation_id
  );
  return { ok: true, token };
}
