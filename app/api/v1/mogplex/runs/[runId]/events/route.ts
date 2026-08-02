import { resolveApiKey } from "@/lib/auth/api-key";
import { parseMogplexApiListLimit } from "@/lib/mogplex-api/request";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { listMogplexApiRunEvents } from "@/lib/mogplex-api/run-control";
import type { NextRequest } from "next/server";

type MogplexApiRunEventsGetDeps = {
  resolveApiKey: typeof resolveApiKey;
  listEvents: typeof listMogplexApiRunEvents;
};

const defaultMogplexApiRunEventsGetDeps: MogplexApiRunEventsGetDeps = {
  resolveApiKey,
  listEvents: listMogplexApiRunEvents,
};

export function createMogplexApiRunEventsGetHandler(
  overrides: Partial<MogplexApiRunEventsGetDeps> = {}
) {
  const deps: MogplexApiRunEventsGetDeps = {
    ...defaultMogplexApiRunEventsGetDeps,
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
    const limit = parseMogplexApiListLimit(
      request.nextUrl.searchParams.get("limit")
    );

    try {
      const result = await deps.listEvents({
        userId: user.userId,
        runId,
        limit,
      });
      if (!result) {
        return mogplexApiError("NOT_FOUND", "Run not found", 404);
      }
      return mogplexApiSuccess(result);
    } catch (error) {
      console.error("[mogplex-api/runs] failed to list run events", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to list events", 500);
    }
  };
}

export const GET = createMogplexApiRunEventsGetHandler();
