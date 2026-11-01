import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl, normalizeAppRedirectPath } from "@/lib/app-url";
import { getUserId } from "@/lib/auth";
import {
  buildGithubAppUserAuthorizeUrl,
  GITHUB_APP_USER_CALLBACK_PATH,
  GITHUB_APP_USER_RETURN_COOKIE,
  GITHUB_APP_USER_STATE_COOKIE,
  hasGithubAppUserAuthConfig,
} from "@/lib/github-app-user-auth";
import { findProfileGithubLogin } from "@/lib/github-profile-login";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 600,
  path: "/",
};

/** Start a GitHub App user authorization for the signed-in account. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = normalizeAppRedirectPath(url.searchParams.get("next"));
  const userId = await getUserId();
  if (!userId) {
    const loginUrl = buildAppUrl("/login", request);
    if (next !== "/") loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }
  if (!hasGithubAppUserAuthConfig()) {
    return NextResponse.redirect(
      buildAppUrl("/?error=github_app_user_unavailable", request)
    );
  }

  const state = crypto.randomUUID();
  const [cookieStore, login] = await Promise.all([
    cookies(),
    // The callback accepts only the connected account, so suggest it.
    findProfileGithubLogin(userId, "github-app-user"),
  ]);
  cookieStore.set(GITHUB_APP_USER_STATE_COOKIE, state, COOKIE_OPTIONS);
  cookieStore.set(GITHUB_APP_USER_RETURN_COOKIE, next, COOKIE_OPTIONS);
  return NextResponse.redirect(
    buildGithubAppUserAuthorizeUrl({
      state,
      login,
      redirectUri: buildAppUrl(
        GITHUB_APP_USER_CALLBACK_PATH,
        request
      ).toString(),
    })
  );
}
