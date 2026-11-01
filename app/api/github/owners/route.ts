import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { loadGithubRepoCreationOwnerTargets } from "@/app/api/github/_lib/repo-owner-targets";
import { hasGithubAppConfig } from "@/lib/github-app";
import {
  hasGithubAppUserAuthConfig,
  hasGithubAppUserGrant,
} from "@/lib/github-app-user-auth";
import type { GithubRepoOwnerTarget } from "@/lib/github-owners";
import { getOAuthToken } from "@/lib/oauth-tokens";
import {
  GITHUB_ORG_READ_SCOPE,
  GITHUB_REAUTHORIZE_HEADER,
} from "@/lib/github-oauth";

/**
 * In an App deployment a personal repository is created with the user's own
 * App authorization, so the picker says when that step is still needed.
 */
async function markPersonalAuthorization(
  userId: string,
  targets: GithubRepoOwnerTarget[]
) {
  if (!hasGithubAppConfig() || !hasGithubAppUserAuthConfig()) return targets;
  return Promise.all(
    targets.map(async (target) => {
      if (target.kind !== "personal") return target;
      const authorized = await hasGithubAppUserGrant(
        userId,
        target.login
      ).catch(() => false);
      return { ...target, authorization_required: !authorized };
    })
  );
}

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
    const headers =
      oauthScopes !== null && !oauthScopes.includes(GITHUB_ORG_READ_SCOPE)
        ? { [GITHUB_REAUTHORIZE_HEADER]: GITHUB_ORG_READ_SCOPE }
        : undefined;
    return NextResponse.json(annotated, { headers });
  } catch (error) {
    console.error("[github-owners] failed to load repo creation owners", {
      userId,
      error,
    });
    return NextResponse.json([], { status: 502 });
  }
}
