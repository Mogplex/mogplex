import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl } from "@/lib/app-url";
import { getGithubAppInstallUrl, hasGithubAppConfig } from "@/lib/github-app";
import { getUserId } from "@/lib/auth";
import { GITHUB_OAUTH_SCOPE } from "@/lib/github-oauth";

function requireEnv(name: "GITHUB_CLIENT_ID") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const userId = await getUserId();

  if (!userId) {
    return NextResponse.redirect(buildAppUrl("/login", request));
  }

  if (hasGithubAppConfig()) {
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
