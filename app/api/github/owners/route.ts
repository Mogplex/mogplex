import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { loadGithubRepoCreationOwnerTargets } from "@/app/api/github/_lib/repo-owner-targets";
import { getOAuthToken } from "@/lib/oauth-tokens";

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const githubToken = await getOAuthToken(userId, "github").catch(() => null);

  if (!githubToken) {
    return NextResponse.json([]);
  }

  try {
    return NextResponse.json(
      await loadGithubRepoCreationOwnerTargets(userId, githubToken)
    );
  } catch (error) {
    console.error("[github-owners] failed to load repo creation owners", {
      userId,
      error,
    });
    return NextResponse.json([], { status: 502 });
  }
}
