import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl } from "@/lib/app-url";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGithubInstallation, hasGithubAppConfig } from "@/lib/github-app";
import {
  syncGithubInstallationReposForUser,
  syncGithubReposForUser,
} from "@/lib/github-sync";
import { storeOAuthToken } from "@/lib/oauth-tokens";
import { getUserId } from "@/lib/auth";

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
  const redirect = (path: string) =>
    NextResponse.redirect(buildAppUrl(path, request));

  if (installationIdParam && hasGithubAppConfig()) {
    if (!userId) {
      return redirect("/login");
    }

    const installationId = Number(installationIdParam);
    if (!Number.isFinite(installationId)) {
      return redirect("/?error=github_installation_invalid");
    }

    try {
      const installation = await getGithubInstallation(installationId);

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
        return redirect("/?error=github_installation_persist");
      }

      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .update({
          github_auth_mode: "app",
        })
        .eq("id", userId);

      if (profileError) {
        console.error("Failed to update GitHub profile mode", profileError);
        return redirect("/?error=github_profile_update");
      }

      try {
        await syncGithubInstallationReposForUser(userId, installationId);
      } catch (error) {
        console.error(
          "GitHub App repo sync failed after install callback",
          error
        );
        return redirect("/?github=connected&repo_sync=failed");
      }

      cookieStore.delete("github_app_install_pending");
      return redirect("/?github=connected");
    } catch (error) {
      console.error("GitHub App install callback failed", error);
      return redirect("/?error=github_installation_fetch");
    }
  }

  if (!code || !state || state !== storedState) {
    return redirect("/?error=invalid_state");
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
    return redirect("/?error=github_token_exchange");
  }

  const { access_token, error } = await tokenRes.json();

  if (error || !access_token) {
    return redirect("/?error=github_token_error");
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userRes.ok) {
    return redirect("/?error=github_user_fetch");
  }

  const ghUser = await userRes.json();

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({
      github_username: ghUser.login,
      github_user_id: typeof ghUser.id === "number" ? ghUser.id : null,
      github_auth_mode: "oauth",
    })
    .eq("id", userId);

  if (profileError) {
    return redirect("/?error=github_profile_update");
  }

  try {
    await storeOAuthToken(userId, "github", access_token);
  } catch (tokenStoreError) {
    console.error("Failed to store GitHub OAuth token", {
      userId,
      tokenStoreError,
    });
    return redirect("/?error=github_token_store");
  }

  try {
    await syncGithubReposForUser(userId, access_token);
  } catch (error) {
    console.error("GitHub repo sync failed after OAuth callback", error);
    return redirect("/?github=connected&repo_sync=failed");
  }

  return redirect("/?github=connected");
}
