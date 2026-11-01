import {
  deleteOAuthToken,
  getOAuthToken,
  storeOAuthToken,
} from "@/lib/oauth-tokens";

/** Path GitHub returns to after a user authorizes the Mogplex App. */
export const GITHUB_APP_USER_CALLBACK_PATH =
  "/api/auth/github/app-user/callback";
export const GITHUB_APP_USER_STATE_COOKIE = "github_app_user_state";
export const GITHUB_APP_USER_RETURN_COOKIE = "github_app_user_return_to";

/** Refresh this long before GitHub's expiry so a create never races it. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * A GitHub App user authorization. Personal-account repositories can only be
 * created with a user token, so this grant is what creates them.
 */
export type GithubAppUserGrant = {
  login: string;
  accessToken: string;
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
};

const defaultDeps = {
  env: process.env as Env,
  fetch: (input: string, init?: RequestInit) => fetch(input, init),
  now: () => Date.now(),
  getToken: (userId: string) => getOAuthToken(userId, "github_app"),
  storeToken: (userId: string, value: string) =>
    storeOAuthToken(userId, "github_app", value),
  deleteToken: (userId: string) => deleteOAuthToken(userId, "github_app"),
};
type Deps = typeof defaultDeps;

export class GithubAppUserAuthError extends Error {
  code: string;

  constructor(code: string) {
    super(`GitHub App user authorization failed: ${code}`);
    this.name = "GithubAppUserAuthError";
    this.code = code;
  }
}

type Env = Record<string, string | undefined>;

function clientCredentials(env: Env) {
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Whether this deployment can ask users to authorize the GitHub App. */
export function hasGithubAppUserAuthConfig(env: Env = process.env) {
  return clientCredentials(env) !== null;
}

export function buildGithubAppUserAuthorizeUrl(input: {
  state: string;
  redirectUri: string;
  login?: string | null;
  env?: Env;
}) {
  const credentials = clientCredentials(input.env ?? process.env);
  if (!credentials) throw new GithubAppUserAuthError("not_configured");
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
  });
  // Suggests the account already connected; GitHub still lets the user choose.
  if (input.login) params.set("login", input.login);
  return `https://github.com/login/oauth/authorize?${params}`;
}

async function requestToken(
  params: Record<string, string>,
  deps: Deps
): Promise<Omit<GithubAppUserGrant, "login">> {
  const credentials = clientCredentials(deps.env);
  if (!credentials) throw new GithubAppUserAuthError("not_configured");
  const response = await deps.fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        ...params,
      }),
      cache: "no-store",
    }
  );
  if (!response.ok)
    throw new Error(`GitHub token request failed (${response.status})`);
  const body = (await response.json()) as TokenResponse;
  if (body.error || typeof body.access_token !== "string") {
    throw new GithubAppUserAuthError(body.error ?? "missing_access_token");
  }
  const issuedAt = deps.now();
  const expiry = (seconds: number | undefined) =>
    typeof seconds === "number" && seconds > 0
      ? issuedAt + seconds * 1000
      : null;
  return {
    accessToken: body.access_token,
    accessTokenExpiresAt: expiry(body.expires_in),
    refreshToken:
      typeof body.refresh_token === "string" ? body.refresh_token : null,
    refreshTokenExpiresAt: expiry(body.refresh_token_expires_in),
  };
}

/** Exchange the callback's code for the user's App authorization. */
export function exchangeGithubAppUserCode(
  code: string,
  redirectUri: string,
  overrides: Partial<Deps> = {}
) {
  return requestToken(
    { code, redirect_uri: redirectUri },
    { ...defaultDeps, ...overrides }
  );
}

export async function storeGithubAppUserGrant(
  userId: string,
  grant: GithubAppUserGrant,
  overrides: Partial<Deps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  await deps.storeToken(userId, JSON.stringify(grant));
}

function parseGrant(raw: string | null): GithubAppUserGrant | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<GithubAppUserGrant>;
    if (
      typeof value.login !== "string" ||
      typeof value.accessToken !== "string"
    ) {
      return null;
    }
    return {
      login: value.login,
      accessToken: value.accessToken,
      accessTokenExpiresAt: value.accessTokenExpiresAt ?? null,
      refreshToken: value.refreshToken ?? null,
      refreshTokenExpiresAt: value.refreshTokenExpiresAt ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * The user's App user token for `login`, refreshed when it is about to
 * expire. Returns null when the user must authorize (again): no grant, a
 * grant for another GitHub account, or a refresh token GitHub no longer
 * accepts. A GitHub outage during refresh throws, so it is not mistaken for
 * a missing authorization.
 */
export async function getGithubAppUserToken(
  userId: string,
  login: string,
  overrides: Partial<Deps> = {}
): Promise<string | null> {
  const deps = { ...defaultDeps, ...overrides };
  const grant = parseGrant(await deps.getToken(userId));
  if (grant?.login.toLowerCase() !== login.toLowerCase()) return null;

  const now = deps.now();
  if (
    grant.accessTokenExpiresAt === null ||
    grant.accessTokenExpiresAt - now > REFRESH_MARGIN_MS
  ) {
    return grant.accessToken;
  }
  if (
    !grant.refreshToken ||
    (grant.refreshTokenExpiresAt !== null && grant.refreshTokenExpiresAt <= now)
  ) {
    return null;
  }
  try {
    const refreshed = await requestToken(
      { grant_type: "refresh_token", refresh_token: grant.refreshToken },
      deps
    );
    await deps.storeToken(
      userId,
      JSON.stringify({ ...refreshed, login: grant.login })
    );
    return refreshed.accessToken;
  } catch (error) {
    if (
      !(error instanceof GithubAppUserAuthError) ||
      error.code === "not_configured"
    ) {
      throw error;
    }
    // GitHub rejected the refresh token: the user revoked it or it was used.
    await deps.deleteToken(userId);
    return null;
  }
}

/** Whether the user has authorized the App for `login`, without refreshing. */
export async function hasGithubAppUserGrant(
  userId: string,
  login: string,
  overrides: Partial<Deps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const grant = parseGrant(await deps.getToken(userId));
  if (grant?.login.toLowerCase() !== login.toLowerCase()) return false;
  return (
    grant.refreshTokenExpiresAt === null ||
    grant.refreshTokenExpiresAt > deps.now()
  );
}
