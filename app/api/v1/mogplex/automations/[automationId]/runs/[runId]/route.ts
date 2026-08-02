import { resolveApiKey } from "@/lib/auth/api-key";
import { mogplexAutomationErrorResponse } from "@/lib/mogplex-api/automation-response";
import { getMogplexApiAutomationRunLogs } from "@/lib/mogplex-api/automations";
import {
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import type { NextRequest } from "next/server";

export function createMogplexApiAutomationRunGetHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    getRunLogs?: typeof getMogplexApiAutomationRunLogs;
  } = {}
) {
  const resolveKey = overrides.resolveApiKey ?? resolveApiKey;
  const getRunLogs = overrides.getRunLogs ?? getMogplexApiAutomationRunLogs;
  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ automationId: string; runId: string }> }
  ) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: resolveKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;
    try {
      const { automationId, runId } = await params;
      return mogplexApiSuccess({
        run: await getRunLogs(user.userId, automationId, runId),
      });
    } catch (error) {
      return mogplexAutomationErrorResponse(
        error,
        "Failed to load automation run logs"
      );
    }
  };
}

export const GET = createMogplexApiAutomationRunGetHandler();
