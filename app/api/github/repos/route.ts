import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncGithubReposForUser } from "@/lib/github-sync";
import { getOAuthToken } from "@/lib/oauth-tokens";
import { requireUserId } from "@/lib/auth";
import { TEAM_RESOURCE_WRITE_CAPABILITY } from "@/lib/team-capabilities";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";

export async function GET(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const scopeResolution = await resolveProductResourceScope({
    request,
    userId,
    requiredCapability: TEAM_RESOURCE_WRITE_CAPABILITY,
  });
  if (!scopeResolution.ok) {
    return NextResponse.json(
      { error: scopeResolution.error },
      { status: scopeResolution.status }
    );
  }

  const githubToken = await getOAuthToken(userId, "github");

  try {
    const repos = await syncGithubReposForUser(userId, githubToken, {
      productTeamId: scopeResolution.scope.productTeamId,
    });
    const { count: installationCount } = await supabaseAdmin
      .from("github_installations")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (repos.length === 0 && !githubToken && !installationCount) {
      return NextResponse.json(
        { error: "NO_GITHUB_CONNECTION" },
        { status: 400 }
      );
    }
    return NextResponse.json(repos);
  } catch (error) {
    console.error("GitHub repo sync failed", error);
    return NextResponse.json({ error: "GITHUB_SYNC_ERROR" }, { status: 500 });
  }
}
