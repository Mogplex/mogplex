import { resolveApiKey } from "@/lib/auth/api-key";
import {
  normalizeOptionalSearchParam,
  parseMogplexApiListLimit,
} from "@/lib/mogplex-api/request";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { consumeSandboxLaunchResponse } from "@/lib/mogplex-api/sandbox-launch";
import { requireScope } from "@/lib/mogplex-api/scopes";
import { listMogplexApiSandboxes } from "@/lib/mogplex-api/sandboxes";
import type { NextRequest } from "next/server";

type MogplexApiSandboxesGetDeps = {
  resolveApiKey: typeof resolveApiKey;
  listSandboxes: typeof listMogplexApiSandboxes;
  launchSandbox: typeof launchMogplexApiSandbox;
};

const defaultMogplexApiSandboxesGetDeps: MogplexApiSandboxesGetDeps = {
  resolveApiKey,
  listSandboxes: listMogplexApiSandboxes,
  launchSandbox: launchMogplexApiSandbox,
};

async function launchMogplexApiSandbox(
  userId: string,
  body: Record<string, unknown>
) {
  const [
    { createSandboxPostHandler },
    { loadSandboxServiceCredentialsForUser },
  ] = await Promise.all([
    import("@/app/api/sandbox/route"),
    import("@/lib/sandbox/get-user-credentials"),
  ]);
  const credentials = await loadSandboxServiceCredentialsForUser(userId);
  const launch = createSandboxPostHandler({
    getSandboxServiceCredentials: async () => credentials,
  });
  const response = await launch(
    new Request("https://mogplex.internal/api/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
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
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body.repoId !== "string" || !body.repoId.trim()) {
      return mogplexApiError("BAD_REQUEST", "repoId is required", 400);
    }

    try {
      const result = await deps.launchSandbox(user.userId, body);
      if (!result.ok) {
        return mogplexApiError(
          result.status >= 500 ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST",
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
