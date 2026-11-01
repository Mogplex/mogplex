import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  markPersonalAuthorization,
  personalAccountHidden,
} from "@/app/api/github/_lib/personal-authorization";
import { loadGithubRepoCreationOwnerTargets } from "@/app/api/github/_lib/repo-owner-targets";
import { hasGithubAppConfig } from "@/lib/github-app";
import { getOAuthToken } from "@/lib/oauth-tokens";
import {
  GITHUB_ORG_READ_SCOPE,
  GITHUB_PERSONAL_UNAVAILABLE_HEADER,
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
      githubToken,
      { requireOwner: hasGithubAppConfig() }
    );
    const annotated = await markPersonalAuthorization(userId, targets);
    const headers: Record<string, string> = {};
    if (oauthScopes !== null && !oauthScopes.includes(GITHUB_ORG_READ_SCOPE))
      headers[GITHUB_REAUTHORIZE_HEADER] = GITHUB_ORG_READ_SCOPE;
    if (personalAccountHidden(targets, annotated))
      headers[GITHUB_PERSONAL_UNAVAILABLE_HEADER] = "1";
    return NextResponse.json(annotated, { headers });
  } catch (error) {
    console.error("[github-owners] failed to load repo creation owners", {
      userId,
      error,
    });
    return NextResponse.json([], { status: 502 });
  }
}
