import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl, normalizeAppRedirectPath } from "@/lib/app-url";
import { getUserId } from "@/lib/auth";
import {
  exchangeGithubAppUserCode,
  GITHUB_APP_USER_CALLBACK_PATH,
  GITHUB_APP_USER_RETURN_COOKIE,
  GITHUB_APP_USER_STATE_COOKIE,
  storeGithubAppUserGrant,
} from "@/lib/github-app-user-auth";
import { GITHUB_APP_USER_OUTCOME_PARAM } from "@/lib/github-oauth";
import { fetchGithubCurrentUserLogin } from "@/lib/github-owners";
import { getOAuthToken } from "@/lib/oauth-tokens";

type CookieStore = {
  get: (name: string) => { value: string } | undefined;
  delete: (name: string) => unknown;
};

const defaultDeps = {
  getCookieStore: async (): Promise<CookieStore> => cookies(),
  getUserId,
  exchangeCode: exchangeGithubAppUserCode,
  storeGrant: storeGithubAppUserGrant,
  getIdentityToken: (userId: string) => getOAuthToken(userId, "github"),
  fetchLogin: fetchGithubCurrentUserLogin,
};

/**
 * GitHub returns here after the user authorizes the App. The grant is kept
 * only when it belongs to the GitHub account already connected to Mogplex, so
 * a user cannot attach someone else's account by authorizing as them.
 */
export function createGithubAppUserCallbackHandler(
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function GET(request: Request) {
    const url = new URL(request.url);
    const cookieStore = await deps.getCookieStore();
    const storedState = cookieStore.get(GITHUB_APP_USER_STATE_COOKIE)?.value;
    const returnTo = normalizeAppRedirectPath(
      cookieStore.get(GITHUB_APP_USER_RETURN_COOKIE)?.value
    );
    cookieStore.delete(GITHUB_APP_USER_STATE_COOKIE);
    cookieStore.delete(GITHUB_APP_USER_RETURN_COOKIE);

    const back = (outcome: string) => {
      const target = buildAppUrl(returnTo, request);
      target.searchParams.set(GITHUB_APP_USER_OUTCOME_PARAM, outcome);
      return NextResponse.redirect(target);
    };

    const userId = await deps.getUserId();
    if (!userId) return NextResponse.redirect(buildAppUrl("/login", request));
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || !storedState || state !== storedState)
      return back("state_mismatch");

    try {
      const redirectUri = buildAppUrl(
        GITHUB_APP_USER_CALLBACK_PATH,
        request
      ).toString();
      const tokens = await deps.exchangeCode(code, redirectUri);
      const identityToken = await deps.getIdentityToken(userId);
      const [authorizedLogin, connectedLogin] = await Promise.all([
        deps.fetchLogin(tokens.accessToken),
        identityToken ? deps.fetchLogin(identityToken) : null,
      ]);
      if (
        !authorizedLogin ||
        authorizedLogin.toLowerCase() !== connectedLogin?.toLowerCase()
      ) {
        return back("account_mismatch");
      }
      await deps.storeGrant(userId, { ...tokens, login: authorizedLogin });
      return back("authorized");
    } catch (error) {
      console.error("[github-app-user] authorization failed", {
        userId,
        error,
      });
      return back("failed");
    }
  };
}

export const GET = createGithubAppUserCallbackHandler();
