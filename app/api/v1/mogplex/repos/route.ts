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
import { listMogplexApiRepos } from "@/lib/mogplex-api/repos";
import type { NextRequest } from "next/server";

type MogplexApiReposGetDeps = {
  resolveApiKey: typeof resolveApiKey;
  listRepos: typeof listMogplexApiRepos;
};

const defaultMogplexApiReposGetDeps: MogplexApiReposGetDeps = {
  resolveApiKey,
  listRepos: listMogplexApiRepos,
};

export function createMogplexApiReposGetHandler(
  overrides: Partial<MogplexApiReposGetDeps> = {}
) {
  const deps: MogplexApiReposGetDeps = {
    ...defaultMogplexApiReposGetDeps,
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
    const query = normalizeOptionalSearchParam(
      request.nextUrl.searchParams.get("q")
    );
    const id = normalizeOptionalSearchParam(
      request.nextUrl.searchParams.get("id")
    );

    try {
      const repos = await deps.listRepos(user.userId, { query, id, limit });
      return mogplexApiSuccess({ repos });
    } catch (error) {
      console.error("[mogplex-api/repos] failed to list repos", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to list repos", 500);
    }
  };
}

export const GET = createMogplexApiReposGetHandler();
