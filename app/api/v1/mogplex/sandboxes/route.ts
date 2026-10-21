import { resolveApiKey } from "@/lib/auth/api-key";
import {
  buildInternalApiHeaders,
  getInternalApiSecret,
} from "@/lib/internal-api-auth";
import { getOwnedRepo } from "@/lib/repos";
import type { resolveMogplexOAuthToken } from "@/lib/auth/mogplex-oauth";
import {
  normalizeOptionalSearchParam,
  parseMogplexApiListLimit,
} from "@/lib/mogplex-api/request";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
  type MogplexApiErrorCode,
} from "@/lib/mogplex-api/response";
import {
  consumeSandboxLaunchResponse,
  type MogplexApiSandboxLaunchResult,
} from "@/lib/mogplex-api/sandbox-launch";
import { requireFullAccessKey } from "@/lib/mogplex-api/credential-boundary";
import {
  requireKeyAllowedOn,
  type LoadTeamKeyAccess,
} from "@/lib/mogplex-api/team-key-access";
import { requireScope } from "@/lib/mogplex-api/scopes";
import { listMogplexApiSandboxes } from "@/lib/mogplex-api/sandboxes";
import type { NextRequest } from "next/server";

type MogplexApiSandboxesGetDeps = {
  resolveApiKey: typeof resolveApiKey;
  /** Test seam for OAuth (interactive) bearer tokens. */
  resolveOAuthToken?: typeof resolveMogplexOAuthToken;
  listSandboxes: typeof listMogplexApiSandboxes;
  launchSandbox: typeof launchMogplexApiSandbox;
  /** Test seam for the repository's team key access. */
  loadTeamKeyAccess?: LoadTeamKeyAccess;
};

const defaultMogplexApiSandboxesGetDeps: MogplexApiSandboxesGetDeps = {
  resolveApiKey,
  listSandboxes: listMogplexApiSandboxes,
  launchSandbox: launchMogplexApiSandbox,
};

async function postMogplexApiSandbox(request: Request) {
  const [{ createSandboxPostHandler }, { createMogplexApiSandboxPostDeps }] =
    await Promise.all([
      import("@/app/api/sandbox/route"),
      import("./_lib/launch-deps"),
    ]);
  return createSandboxPostHandler(createMogplexApiSandboxPostDeps())(request);
}

export async function launchMogplexApiSandbox(
  userId: string,
  body: Record<string, unknown>,
  post = postMogplexApiSandbox
): Promise<MogplexApiSandboxLaunchResult> {
  if (!getInternalApiSecret()) {
    console.error(
      "[mogplex-api/sandboxes] INTERNAL_API_SECRET is not configured"
    );
    return {
      ok: false,
      status: 503,
      error: "The sandbox service is not available. Try again later.",
    };
  }
  const repoId = typeof body.repoId === "string" ? body.repoId.trim() : "";
  if (!repoId) return { ok: false, status: 400, error: "repoId is required" };
  // OAuth skips key-policy lookup, so resolve scope for every caller here.
  // Keep v1's user_id boundary; repos_owner_shape_check forbids mixed scopes.
  const repo = await getOwnedRepo<{ product_team_id: string | null }>(
    repoId,
    userId,
    "product_team_id"
  );
  if (!repo) return { ok: false, status: 404, error: "Repository not found" };
  const response = await post(
    new Request("https://mogplex.internal/api/sandbox", {
      method: "POST",
      // Reusing a stopped VM delegates to RESTART, which authenticates again.
      headers: buildInternalApiHeaders(userId, {
        teamId: repo.product_team_id,
      }),
      body: JSON.stringify(body),
    })
  );
  return consumeSandboxLaunchResponse(response);
}

export function createMogplexApiSandboxesGetHandler(
  overrides: Partial<MogplexApiSandboxesGetDeps> = {}
) {
  const deps: MogplexApiSandboxesGetDeps = {
    ...defaultMogplexApiSandboxesGetDeps,
    ...overrides,
  };

  return async function GET(request: NextRequest) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
      resolveOAuthToken: deps.resolveOAuthToken,
    });
    if (!user.ok) return user.response;

    const limit = parseMogplexApiListLimit(
      request.nextUrl.searchParams.get("limit")
    );
    const repoId = normalizeOptionalSearchParam(
      request.nextUrl.searchParams.get("repo_id")
    );
    const status = normalizeOptionalSearchParam(
      request.nextUrl.searchParams.get("status")
    );

    try {
      const sandboxes = await deps.listSandboxes(user.userId, {
        repoId,
        status,
        limit,
      });
      return mogplexApiSuccess({ sandboxes });
    } catch (error) {
      console.error("[mogplex-api/sandboxes] failed to list sandboxes", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to list sandboxes", 500);
    }
  };
}

export const GET = createMogplexApiSandboxesGetHandler();

function sandboxLaunchErrorCode(status: number): MogplexApiErrorCode {
  switch (status) {
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    default:
      return status >= 500 ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST";
  }
}

export function createMogplexApiSandboxesPostHandler(
  overrides: Partial<MogplexApiSandboxesGetDeps> = {}
) {
  const deps: MogplexApiSandboxesGetDeps = {
    ...defaultMogplexApiSandboxesGetDeps,
    ...overrides,
  };

  return async function POST(request: NextRequest) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
      resolveOAuthToken: deps.resolveOAuthToken,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;
    const restricted = requireFullAccessKey(user);
    if (restricted) return restricted;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body.repoId !== "string" || !body.repoId.trim()) {
      return mogplexApiError("BAD_REQUEST", "repoId is required", 400);
    }
    const teamRefusal = await requireKeyAllowedOn(
      user,
      { repoId: body.repoId.trim() },
      deps.loadTeamKeyAccess
    );
    if (teamRefusal) return teamRefusal;

    try {
      const result = await deps.launchSandbox(user.userId, body);
      if (!result.ok) {
        return mogplexApiError(
          sandboxLaunchErrorCode(result.status),
          result.error,
          result.status
        );
      }
      return mogplexApiSuccess({ sandbox: result.sandbox }, { status: 202 });
    } catch (error) {
      console.error("[mogplex-api/sandboxes] failed to launch sandbox", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to launch sandbox", 500);
    }
  };
}

export const POST = createMogplexApiSandboxesPostHandler();
