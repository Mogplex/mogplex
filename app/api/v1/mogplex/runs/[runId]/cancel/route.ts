import { resolveApiKey } from "@/lib/auth/api-key";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import {
  MogplexApiRunControlError,
  cancelMogplexApiRun,
} from "@/lib/mogplex-api/run-control";
import type { NextRequest } from "next/server";

type MogplexApiRunCancelPostDeps = {
  resolveApiKey: typeof resolveApiKey;
  cancelRun: typeof cancelMogplexApiRun;
};

const defaultMogplexApiRunCancelPostDeps: MogplexApiRunCancelPostDeps = {
  resolveApiKey,
  cancelRun: cancelMogplexApiRun,
};

function toCancelErrorResponse(error: unknown) {
  if (error instanceof MogplexApiRunControlError) {
    return mogplexApiError(error.code, error.message, error.status);
  }

  console.error("[mogplex-api/runs] failed to cancel run", error);
  return mogplexApiError("INTERNAL_ERROR", "Failed to cancel run", 500);
}

export function createMogplexApiRunCancelPostHandler(
  overrides: Partial<MogplexApiRunCancelPostDeps> = {}
) {
  const deps: MogplexApiRunCancelPostDeps = {
    ...defaultMogplexApiRunCancelPostDeps,
    ...overrides,
  };

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ runId: string }> }
  ) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
    });
    if (!user.ok) return user.response;

    // Cancelling a run is a write op. Read-only tokens get a 403.
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;

    const { runId } = await params;
    try {
      const result = await deps.cancelRun({
        userId: user.userId,
        runId,
      });
      if (!result) {
        return mogplexApiError("NOT_FOUND", "Run not found", 404);
      }
      return mogplexApiSuccess(result);
    } catch (error) {
      return toCancelErrorResponse(error);
    }
  };
}

export const POST = createMogplexApiRunCancelPostHandler();
