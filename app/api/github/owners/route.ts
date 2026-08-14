import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { loadGithubRepoCreationOwnerTargets } from "@/app/api/github/_lib/repo-owner-targets";
import { getOAuthToken } from "@/lib/oauth-tokens";
import {
  GITHUB_ORG_READ_SCOPE,
  GITHUB_REAUTHORIZE_HEADER,
} from "@/lib/github-oauth";

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const githubToken = await getOAuthToken(userId, "github").catch(() => null);

  if (!githubToken) {
    return NextResponse.json([]);
  }

  try {
    const { targets, oauthScopes } = await loadGithubRepoCreationOwnerTargets(
      userId,
      githubToken
    );
    const headers =
      oauthScopes !== null && !oauthScopes.includes(GITHUB_ORG_READ_SCOPE)
        ? { [GITHUB_REAUTHORIZE_HEADER]: GITHUB_ORG_READ_SCOPE }
        : undefined;
    return NextResponse.json(targets, { headers });
  } catch (error) {
    console.error("[github-owners] failed to load repo creation owners", {
      userId,
      error,
    });
    return NextResponse.json([], { status: 502 });
  }
}
