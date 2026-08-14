import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  checkGithubRepoAvailability,
  type GithubRepoAvailability,
} from "@/lib/github-create";
import { validateGithubRepoName } from "@/lib/github-repo-name";
import { getOAuthToken } from "@/lib/oauth-tokens";

type GithubRepoAvailabilityRouteDeps = {
  requireUserId: typeof requireUserId;
  getGithubToken: typeof getOAuthToken;
  checkAvailability: (
    token: string,
    owner: string,
    name: string
  ) => Promise<GithubRepoAvailability>;
};

export function createGithubRepoAvailabilityGetHandler(
  overrides: Partial<GithubRepoAvailabilityRouteDeps> = {}
) {
  const deps: GithubRepoAvailabilityRouteDeps = {
    requireUserId,
    getGithubToken: getOAuthToken,
    checkAvailability: checkGithubRepoAvailability,
    ...overrides,
  };

  return async function GET(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { searchParams } = new URL(request.url);
    const validation = validateGithubRepoName(searchParams.get("name"));
    if (!validation.ok) {
      return NextResponse.json(
        { availability: "invalid", error: validation.message },
        { status: 400 }
      );
    }

    const token = await deps.getGithubToken(userId, "github").catch(() => null);
    if (!token) {
      return NextResponse.json(
        { availability: "invalid", error: "Connect GitHub account first" },
        { status: 400 }
      );
    }

    const owner = searchParams.get("owner")?.trim() || "";
    if (!owner) {
      return NextResponse.json(
        {
          availability: "invalid",
          error: "Select a GitHub account",
        },
        { status: 400 }
      );
    }

    // This debounced read-only probe intentionally accepts an arbitrary owner:
    // GitHub still limits the result to repositories visible to this user's
    // token. Re-loading permission-filtered org targets here would fan out two
    // extra GitHub requests per org on every keystroke. The mutating POST below
    // this route's namespace recomputes and enforces the allowed owner targets.

    let availability: GithubRepoAvailability;
    try {
      availability = await deps.checkAvailability(
        token,
        owner,
        validation.name
      );
    } catch (error) {
      console.warn("[github-repo-availability] verification unavailable", {
        userId,
        owner,
        name: validation.name,
        error,
      });
      availability = "unverified";
    }

    return NextResponse.json({
      availability,
      owner,
      name: validation.name,
    });
  };
}

export const GET = createGithubRepoAvailabilityGetHandler();
