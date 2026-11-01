import {
  createGithubInstallationAccessToken,
  hasGithubAppConfig,
} from "@/lib/github-app";
import {
  extractGithubApiErrorMessage,
  type GithubRepoCreateError,
} from "@/lib/github-create";
import type { GithubRepoOwnerTarget } from "@/lib/github-owners";
import { getGithubOAuthRepositoryToken } from "@/lib/github-repository-auth";
import { getOAuthToken } from "@/lib/oauth-tokens";

export type GithubRepoCreateRefusal = {
  ok: false;
  status: 403 | 409;
  code: string;
  error: string;
};

export type GithubRepoCreateCredential =
  | { ok: true; token: string; viaInstallation: boolean }
  | GithubRepoCreateRefusal;

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
  if (!deps.appConfigured())
    return { ok: true, token: userToken, viaInstallation: false };
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
      error: `Ask an owner of ${target.login} to install the Mogplex GitHub App and connect it in Mogplex.`,
    };
  }
  try {
    const { token } = await deps.createInstallationToken(
      target.github_installation_id
    );
    return { ok: true, token, viaInstallation: true };
  } catch (error) {
    // A suspended or removed installation is the owner's to fix, not a
    // server fault; GitHub's response stays in the log.
    console.warn("[github-repo-create] installation token unavailable", {
      owner: target.login,
      installationId: target.github_installation_id,
      error,
    });
    return {
      ok: false,
      status: 409,
      code: "GITHUB_APP_INSTALLATION_UNAVAILABLE",
      error: `The Mogplex GitHub App on ${target.login} is unavailable. Ask an owner of ${target.login} to reconnect it.`,
    };
  }
}

/**
 * Map GitHub's refusal of a create to the route response. An installation
 * refused with 403 has not accepted the App's Administration permission, so
 * say that instead of GitHub's message.
 */
export function githubRepoCreateErrorResponse(
  error: GithubRepoCreateError,
  context: { ownerLogin: string; viaInstallation: boolean }
): { status: number; body: { error: string; code?: string } } {
  if (error.status === 403 && context.viaInstallation) {
    return {
      status: 403,
      body: {
        code: "GITHUB_APP_PERMISSION_REQUIRED",
        error: `The Mogplex GitHub App on ${context.ownerLogin} cannot create repositories yet. Ask an owner of ${context.ownerLogin} to accept the App's updated permissions on GitHub.`,
      },
    };
  }
  const status =
    error.status === 422
      ? 409
      : error.status === 401 || error.status === 403
        ? 403
        : 502;
  return {
    status,
    body: {
      error:
        extractGithubApiErrorMessage(error.body) ||
        "GitHub repo creation failed",
    },
  };
}
