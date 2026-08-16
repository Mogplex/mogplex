import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl, normalizeAppRedirectPath } from "@/lib/app-url";
import { getGithubAppInstallUrl, hasGithubAppConfig } from "@/lib/github-app";
import { getUserId } from "@/lib/auth";
import {
  GITHUB_OAUTH_SCOPE,
  GITHUB_RETURN_TO_COOKIE,
} from "@/lib/github-oauth";

function requireEnv(name: "GITHUB_CLIENT_ID") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const userId = await getUserId();

  if (!userId) {
    // Signed-out callers belong on the sign-in page, never on the legacy
    // access-code gate — this route only ever serves an existing account.
    const loginUrl = buildAppUrl("/login", request);
    const next = normalizeAppRedirectPath(url.searchParams.get("next"));
    if (next !== "/") loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }

  // Round-tripped to the callback, which has no query string of its own to
  // carry it: GitHub controls the redirect back.
  const returnTo = normalizeAppRedirectPath(url.searchParams.get("next"));
  if (returnTo === "/") {
    cookieStore.delete(GITHUB_RETURN_TO_COOKIE);
  } else {
    cookieStore.set(GITHUB_RETURN_TO_COOKIE, returnTo, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  }

  // Re-authorization has to go through OAuth even when the GitHub App is
  // configured: only the OAuth grant refreshes token scopes, and the App
  // install page cannot add a missing `read:org`.
  const reauthorize = url.searchParams.get("reauthorize") === "1";

  if (hasGithubAppConfig() && !reauthorize) {
    cookieStore.set("github_app_install_pending", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: "/",
    });
    cookieStore.delete("github_reconcile_skip");
    return NextResponse.redirect(getGithubAppInstallUrl());
  }

  const state = crypto.randomUUID();
  cookieStore.set("github_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: requireEnv("GITHUB_CLIENT_ID"),
    redirect_uri: buildAppUrl("/api/auth/github/callback", request).toString(),
    scope: GITHUB_OAUTH_SCOPE,
    state,
  });

  return NextResponse.redirect(
    `https://github.com/login/oauth/authorize?${params}`
  );
}
