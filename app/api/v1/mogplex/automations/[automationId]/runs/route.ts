import { resolveApiKey } from "@/lib/auth/api-key";
import { mogplexAutomationErrorResponse } from "@/lib/mogplex-api/automation-response";
import { listMogplexApiAutomationRuns } from "@/lib/mogplex-api/automations";
import { parseMogplexApiListLimit } from "@/lib/mogplex-api/request";
import {
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import type { NextRequest } from "next/server";

export function createMogplexApiAutomationRunsGetHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    listRuns?: typeof listMogplexApiAutomationRuns;
  } = {}
) {
  const resolveKey = overrides.resolveApiKey ?? resolveApiKey;
  const listRuns = overrides.listRuns ?? listMogplexApiAutomationRuns;
  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ automationId: string }> }
  ) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: resolveKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;
    try {
      const { automationId } = await params;
      const limit = parseMogplexApiListLimit(
        request.nextUrl.searchParams.get("limit"),
        { defaultLimit: 20, maxLimit: 50 }
      );
      return mogplexApiSuccess({
        runs: await listRuns(user.userId, automationId, limit),
      });
    } catch (error) {
      return mogplexAutomationErrorResponse(
        error,
        "Failed to list automation runs"
      );
    }
  };
}

export const GET = createMogplexApiAutomationRunsGetHandler();
