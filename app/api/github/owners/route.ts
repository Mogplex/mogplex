import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  fetchGithubCurrentUserLogin,
  fetchGithubUserOrgs,
  buildGithubRepoOwnerTargets,
} from "@/lib/github-owners";
import { getOAuthToken } from "@/lib/oauth-tokens";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const [githubToken, profileResult, installationsResult] = await Promise.all([
    getOAuthToken(userId, "github").catch(() => null),
    supabaseAdmin
      .from("profiles")
      .select("github_username")
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("github_installations")
      .select("installation_id, account_login, account_type, target_type")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  if (!githubToken) {
    return NextResponse.json([]);
  }

  const profileUsername =
    profileResult.data?.github_username ||
    (await fetchGithubCurrentUserLogin(githubToken));
  const orgLogins = await fetchGithubUserOrgs(githubToken).catch((error) => {
    console.error("[github-owners] failed to load GitHub orgs", {
      userId,
      error,
    });
    return [] as string[];
  });

  return NextResponse.json(
    buildGithubRepoOwnerTargets({
      githubUsername: profileUsername,
      installations: installationsResult.data || [],
      orgLogins,
    })
  );
}
