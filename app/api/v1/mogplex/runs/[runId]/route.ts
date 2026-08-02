import { resolveApiKey } from "@/lib/auth/api-key";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { loadMogplexApiRun } from "@/lib/mogplex-api/runs";
import type { NextRequest } from "next/server";

type MogplexApiRunDetailGetDeps = {
  resolveApiKey: typeof resolveApiKey;
  loadRun: typeof loadMogplexApiRun;
};

const defaultMogplexApiRunDetailGetDeps: MogplexApiRunDetailGetDeps = {
  resolveApiKey,
  loadRun: loadMogplexApiRun,
};

export function createMogplexApiRunDetailGetHandler(
  overrides: Partial<MogplexApiRunDetailGetDeps> = {}
) {
  const deps: MogplexApiRunDetailGetDeps = {
    ...defaultMogplexApiRunDetailGetDeps,
    ...overrides,
  };

  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ runId: string }> }
  ) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
    });
    if (!user.ok) return user.response;

    const { runId } = await params;
    try {
      const run = await deps.loadRun({
        userId: user.userId,
        runId,
      });
      if (!run) {
        return mogplexApiError("NOT_FOUND", "Run not found", 404);
      }
      return mogplexApiSuccess({ run });
    } catch (error) {
      console.error("[mogplex-api/runs] failed to load run", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to load run", 500);
    }
  };
}

export const GET = createMogplexApiRunDetailGetHandler();
