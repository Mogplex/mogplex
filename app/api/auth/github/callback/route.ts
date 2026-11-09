import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl, normalizeAppRedirectPath } from "@/lib/app-url";
import {
  getGithubOAuthGrantConfiguration,
  GITHUB_RETURN_TO_COOKIE,
  GITHUB_INSTALL_STATE_COOKIE,
} from "@/lib/github-oauth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGithubInstallation, hasGithubAppConfig } from "@/lib/github-app";
import {
  syncGithubInstallationReposForUser,
  syncGithubReposForUser,
} from "@/lib/github-sync";
import { getOAuthToken, storeOAuthToken } from "@/lib/oauth-tokens";
import {
  fetchGithubIdentityLogin,
  verifyGithubInstallationOwner,
} from "@/lib/github-installation-owner";
import { getUserId } from "@/lib/auth";
import { isGithubOAuthRepositoryAccessAllowed } from "@/lib/github-repository-auth";
import type { GithubInstallFailureReason } from "@/lib/github-install-outcome";

function requireEnv(name: "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const installationIdParam = searchParams.get("installation_id");
  const state = searchParams.get("state");
  const cookieStore = await cookies();
  const storedState = cookieStore.get("github_oauth_state")?.value;
  const userId = await getUserId();

  // Where the user started. Consumed once, so a stale cookie cannot hijack a
  // later connect that did not ask for a return path.
  const returnTo = normalizeAppRedirectPath(
    cookieStore.get(GITHUB_RETURN_TO_COOKIE)?.value
  );
  cookieStore.delete(GITHUB_RETURN_TO_COOKIE);

  const redirect = (path: string) =>
    NextResponse.redirect(buildAppUrl(path, request));

  /**
   * Redirect to the caller's page with the outcome query. Installs started on
   * GitHub carry no return path, so they land on Settings, where the GitHub
   * connection lives; a failure never continues into a chained API route.
   */
  const redirectWithOutcome = (query: string, failed: boolean) => {
    const path =
      returnTo === "/" || (failed && returnTo.startsWith("/api/"))
        ? "/settings/account"
        : returnTo;
    const target = buildAppUrl(path, request);
    for (const [key, value] of new URLSearchParams(query.replace(/^\?/, ""))) {
      target.searchParams.set(key, value);
    }
    return NextResponse.redirect(target);
  };
  const redirectBack = (query: string) => redirectWithOutcome(query, false);
  /** Report a failure the GitHub install toast can explain. */
  const fail = (reason: GithubInstallFailureReason) =>
    redirectWithOutcome(`?github=error&reason=${reason}`, true);

  if (installationIdParam && hasGithubAppConfig()) {
    if (!userId) {
      return redirect("/login");
    }
    // Installs started on GitHub carry no state, so a missing one is accepted
    // and ownership below is the authorization. A state that does not match
    // the one Mogplex issued is still rejected.
    const installState = cookieStore.get(GITHUB_INSTALL_STATE_COOKIE)?.value;
    if (state && installState && state !== installState)
      return fail("github_installation_state");
    cookieStore.delete(GITHUB_INSTALL_STATE_COOKIE);

    const installationId = Number(installationIdParam);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      return fail("github_installation_invalid");
    }

    try {
      const installation = await getGithubInstallation(installationId);
      const githubLogin = await fetchGithubIdentityLogin(
        await getOAuthToken(userId, "github")
      );
      if (!(await verifyGithubInstallationOwner(installation, githubLogin))) {
        return fail("github_installation_owner_required");
      }

      const { error: installationError } = await supabaseAdmin
        .from("github_installations")
        .upsert(
          {
            user_id: userId,
            installation_id: installationId,
            account_login: installation.account?.login || null,
            account_type: installation.account?.type || null,
            target_type: installation.target_type || null,
            permissions: installation.permissions || {},
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,installation_id" }
        );

      if (installationError) {
        console.error(
          "Failed to persist GitHub installation",
          installationError
        );
        return fail("github_installation_persist");
      }

      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .update({
          github_auth_mode: "app",
        })
        .eq("id", userId);

      if (profileError) {
        console.error("Failed to update GitHub profile mode", profileError);
        return fail("github_profile_update");
      }

      try {
        await syncGithubInstallationReposForUser(userId, installationId);
      } catch (error) {
        console.error(
          "GitHub App repo sync failed after install callback",
          error
        );
        return redirectBack("?github=connected&repo_sync=failed");
      }

      cookieStore.delete("github_app_install_pending");
      return redirectBack("?github=connected");
    } catch (error) {
      console.error("GitHub App install callback failed", error);
      return fail("github_installation_fetch");
    }
  }

  if (!code || !state || state !== storedState) {
    return fail("invalid_state");
  }

  if (!userId) {
    return redirect("/login");
  }

  cookieStore.delete("github_oauth_state");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: requireEnv("GITHUB_CLIENT_ID"),
      client_secret: requireEnv("GITHUB_CLIENT_SECRET"),
      code,
    }),
  });

  if (!tokenRes.ok) {
    return fail("github_token_exchange");
  }

  const { access_token, error } = await tokenRes.json();

  if (error || !access_token) {
    return fail("github_token_error");
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userRes.ok) {
    return fail("github_user_fetch");
  }

  const ghUser = await userRes.json();
  let repositoryAuthMode: "app" | "oauth";
  try {
    repositoryAuthMode = getGithubOAuthGrantConfiguration(
      !(await isGithubOAuthRepositoryAccessAllowed(userId))
    ).repositoryAuthMode;
  } catch {
    return fail("github_repository_authorization");
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({
      github_username: ghUser.login,
      github_user_id: typeof ghUser.id === "number" ? ghUser.id : null,
      github_auth_mode: repositoryAuthMode,
    })
    .eq("id", userId);

  if (profileError) {
    return fail("github_profile_update");
  }

  try {
    await storeOAuthToken(userId, "github", access_token);
  } catch (tokenStoreError) {
    console.error("Failed to store GitHub OAuth token", {
      userId,
      tokenStoreError,
    });
    return fail("github_token_store");
  }

  try {
    await syncGithubReposForUser(userId, access_token);
  } catch (error) {
    console.error("GitHub repo sync failed after OAuth callback", error);
    return redirectBack("?github=connected&repo_sync=failed");
  }

  return redirectBack("?github=connected");
}
