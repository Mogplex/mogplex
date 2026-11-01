import {
  createGithubInstallationAccessToken,
  GithubHttpError,
  hasGithubAppConfig,
} from "@/lib/github-app";
import {
  extractGithubApiErrorMessage,
  type GithubRepoCreateError,
} from "@/lib/github-create";
import {
  fetchGithubOrgMembership,
  type GithubRepoOwnerTarget,
} from "@/lib/github-owners";
import { getGithubOAuthRepositoryToken } from "@/lib/github-repository-auth";
import { getOAuthToken } from "@/lib/oauth-tokens";

export type GithubRepoCreateRefusal = {
  ok: false;
  status: 400 | 403 | 409 | 502;
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
  fetchOrgMembership: fetchGithubOrgMembership,
};

/**
 * The user's own GitHub token, used to list owners and check live org
 * membership. In an App deployment this is the identity grant, and the App
 * path never creates a repository with it.
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
  const ownerRefusal = await requireActiveOrgOwner(
    target.login,
    userToken,
    deps
  );
  if (ownerRefusal) return ownerRefusal;
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
 * An installation token ignores the acting user's org policy, so only an
 * active owner creates through it. Membership is read live, which also
 * catches an owner demoted after connecting the installation.
 */
async function requireActiveOrgOwner(
  login: string,
  userToken: string,
  deps: typeof defaultDeps
): Promise<GithubRepoCreateRefusal | null> {
  try {
    const membership = await deps.fetchOrgMembership(userToken, login);
    if (membership.state === "active" && membership.role === "admin")
      return null;
  } catch (error) {
    // GitHub answers 404 for a non-member and 401 for a revoked grant;
    // neither improves on retry.
    if (error instanceof GithubHttpError && error.status === 404)
      return ownerRequired(login);
    if (error instanceof GithubHttpError && error.status === 401) {
      return {
        ok: false,
        status: 400,
        code: "GITHUB_REAUTHORIZE_REQUIRED",
        error: "Reconnect GitHub to continue.",
      };
    }
    console.warn("[github-repo-create] org membership unavailable", {
      owner: login,
      error,
    });
    return {
      ok: false,
      status: 502,
      code: "GITHUB_MEMBERSHIP_UNAVAILABLE",
      error: `Could not confirm your membership in ${login}. Try again.`,
    };
  }
  return ownerRequired(login);
}

function ownerRequired(login: string): GithubRepoCreateRefusal {
  return {
    ok: false,
    status: 403,
    code: "GITHUB_ORG_OWNER_REQUIRED",
    error: `Only an owner of ${login} can create repositories there through the Mogplex GitHub App.`,
  };
}

const INTEGRATION_PERMISSION_REFUSAL =
  /resource not accessible by integration|not have permission/i;

/**
 * Map GitHub's refusal of a create to the route response. An installation
 * refused with 403 has not accepted the App's Repository creation permission, so
 * say that instead of GitHub's message.
 */
export function githubRepoCreateErrorResponse(
  error: GithubRepoCreateError,
  context: { ownerLogin: string; viaInstallation: boolean }
): {
  status: number;
  body: { error: string; code?: string; detail?: string };
} {
  const detail = extractGithubApiErrorMessage(error.body);
  if (error.status === 403 && context.viaInstallation) {
    console.warn("[github-repo-create] installation create refused", {
      owner: context.ownerLogin,
      body: error.body,
    });
  }
  // Rate limits, IP allow lists and org policy also answer 403; only a
  // permission refusal points the user at the App's permissions.
  if (
    error.status === 403 &&
    context.viaInstallation &&
    INTEGRATION_PERMISSION_REFUSAL.test(detail ?? "")
  ) {
    return {
      status: 403,
      body: {
        ...(detail ? { detail } : {}),
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
      error: detail || "GitHub repo creation failed",
    },
  };
}
