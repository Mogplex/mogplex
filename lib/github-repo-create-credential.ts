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
import { hasGithubAppUserAuthConfig } from "@/lib/github-app-user-auth";
import { GITHUB_ORG_READ_SCOPE } from "@/lib/github-oauth";
import { getGithubOAuthRepositoryToken } from "@/lib/github-repository-auth";
import { getOAuthToken } from "@/lib/oauth-tokens";

export type GithubRepoCreateRefusal = {
  ok: false;
  status: 400 | 403 | 409 | 500 | 502;
  code: string;
  error: string;
  /** OAuth scope a reconnect must grant, sent as the reauthorize header. */
  reauthorizeScope?: string;
  /**
   * Where the user grants what is missing, when Mogplex can ask for it. The
   * API cannot know the page the user came from, so a client appends
   * `?next=<its own path>` to return there afterwards.
   */
  authorizeUrl?: string;
};

export type GithubRepoCreateCredential =
  /** `viaApp`: the token carries only the GitHub App's permissions. */
  { ok: true; token: string; viaApp: boolean } | GithubRepoCreateRefusal;

/** Where a user authorizes the GitHub App; clients append `?next=`. */
export const GITHUB_APP_USER_AUTHORIZE_PATH = "/api/auth/github/app-user";

/** A programming error: the App user token lookup was not bound to a user. */
export class AppUserTokenUnboundError extends Error {
  constructor() {
    super("getAppUserToken must be bound to the acting user");
    this.name = "AppUserTokenUnboundError";
  }
}

const defaultDeps = {
  appConfigured: () => hasGithubAppConfig(),
  getIdentityToken: getOAuthToken,
  getRepositoryToken: getGithubOAuthRepositoryToken,
  createInstallationToken: createGithubInstallationAccessToken,
  fetchOrgMembership: fetchGithubOrgMembership,
  appUserAuthConfigured: () => hasGithubAppUserAuthConfig(),
  /**
   * The App user token for a personal account, bound to the acting user.
   * Callers must supply it; the default throws AppUserTokenUnboundError so a
   * missing wiring fails loudly instead of reading as an outage or a false
   * "authorize" prompt.
   */
  getAppUserToken: async (_login: string): Promise<string | null> => {
    throw new AppUserTokenUnboundError();
  },
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
    return { ok: true, token: userToken, viaApp: false };
  if (target.kind === "personal")
    return personalAccountCredential(target, deps);
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
    return { ok: true, token, viaApp: true };
  } catch (error) {
    console.warn("[github-repo-create] installation token unavailable", {
      owner: target.login,
      installationId: target.github_installation_id,
      error,
    });
    // GitHub rejected the App's own JWT: a deployment key or clock problem
    // that retrying cannot fix.
    if (error instanceof GithubHttpError && error.status === 401) {
      console.error("[github-repo-create] GitHub App credentials rejected", {
        installationId: target.github_installation_id,
      });
      return {
        ok: false,
        status: 500,
        code: "GITHUB_APP_MISCONFIGURED",
        error:
          "Mogplex's GitHub App connection needs attention. Try again later.",
      };
    }
    // A suspended (403) or removed (404) installation is the owner's to fix.
    // Anything else (rate limit, outage) is ours, and retryable.
    if (
      !(error instanceof GithubHttpError) ||
      (error.status !== 403 && error.status !== 404)
    ) {
      return {
        ok: false,
        status: 502,
        code: "GITHUB_APP_UNAVAILABLE",
        error: "GitHub is not responding to Mogplex right now. Try again.",
      };
    }
    return {
      ok: false,
      status: 409,
      code: "GITHUB_APP_INSTALLATION_UNAVAILABLE",
      error: `The Mogplex GitHub App on ${target.login} is suspended or was removed. Reinstall it from ${target.login}'s GitHub settings, then connect it in Mogplex.`,
    };
  }
}

/**
 * GitHub creates a personal repository only with a user token, so an App
 * deployment uses the user's own App authorization for their account.
 */
async function personalAccountCredential(
  target: GithubRepoOwnerTarget,
  deps: typeof defaultDeps
): Promise<GithubRepoCreateCredential> {
  if (!deps.appUserAuthConfigured()) {
    return {
      ok: false,
      status: 403,
      code: "GITHUB_APP_USER_AUTHORIZATION_REQUIRED",
      error:
        "Creating a repository in a personal GitHub account is not available on this deployment. Choose an organization where the Mogplex GitHub App is installed.",
    };
  }
  // The user token creates the repository, but Mogplex then works in it
  // through the App installation, so the account must have one.
  if (target.github_installation_id == null) {
    return {
      ok: false,
      status: 403,
      code: "GITHUB_APP_INSTALLATION_REQUIRED",
      error: `Install the Mogplex GitHub App on ${target.login} to create repositories there.`,
    };
  }
  let token: string | null;
  try {
    token = await deps.getAppUserToken(target.login);
  } catch (error) {
    // Missing wiring is a bug, not a GitHub outage; let it fail loudly.
    if (error instanceof AppUserTokenUnboundError) throw error;
    console.warn("[github-repo-create] App user token unavailable", {
      owner: target.login,
      error,
    });
    return {
      ok: false,
      status: 502,
      code: "GITHUB_APP_UNAVAILABLE",
      error: "GitHub is not responding to Mogplex right now. Try again.",
    };
  }
  if (token) return { ok: true, token, viaApp: true };
  return {
    ok: false,
    status: 403,
    code: "GITHUB_APP_USER_AUTHORIZATION_REQUIRED",
    error: `Authorize Mogplex to create repositories in ${target.login}, then try again.`,
    authorizeUrl: GITHUB_APP_USER_AUTHORIZE_PATH,
  };
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
    // GitHub answers 404 for a non-member, 401 for a revoked grant and 403
    // for a grant without read:org; none improves on retry.
    if (error instanceof GithubHttpError && error.status === 404)
      return ownerRequired(login);
    if (
      error instanceof GithubHttpError &&
      (error.status === 401 || error.status === 403)
    ) {
      return {
        ok: false,
        status: 400,
        code: "GITHUB_REAUTHORIZE_REQUIRED",
        error: "Reconnect GitHub to continue.",
        reauthorizeScope: GITHUB_ORG_READ_SCOPE,
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
 * Map GitHub's refusal of a create to the route response. An App credential
 * (installation or App user token) refused with 403 has not accepted the App's
 * Repository creation permission, so say that instead of GitHub's message.
 */
export function githubRepoCreateErrorResponse(
  error: GithubRepoCreateError,
  context: { ownerLogin: string; viaApp: boolean }
): {
  status: number;
  body: { error: string; code?: string; detail?: string };
} {
  const detail = extractGithubApiErrorMessage(error.body);
  if (error.status === 403 && context.viaApp) {
    console.warn("[github-repo-create] App create refused", {
      owner: context.ownerLogin,
      body: error.body,
    });
  }
  // Rate limits, IP allow lists and org policy also answer 403; only a
  // permission refusal points the user at the App's permissions.
  if (
    error.status === 403 &&
    context.viaApp &&
    INTEGRATION_PERMISSION_REFUSAL.test(detail ?? "")
  ) {
    return {
      status: 403,
      body: {
        ...(detail ? { detail } : {}),
        code: "GITHUB_APP_PERMISSION_REQUIRED",
        error: `The Mogplex GitHub App on ${context.ownerLogin} cannot create repositories yet. Accept the App's updated permissions in ${context.ownerLogin}'s GitHub settings under GitHub Apps.`,
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
