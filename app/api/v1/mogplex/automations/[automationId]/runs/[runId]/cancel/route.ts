import type { NextRequest } from "next/server";
import { z } from "zod";
import { resolveApiKey } from "@/lib/auth/api-key";
import { cancelMogplexApiAutomationRun } from "@/lib/mogplex-api/automation-run-control";
import { mogplexAutomationErrorResponse } from "@/lib/mogplex-api/automation-response";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";

const paramsSchema = z.object({
  automationId: z.string().uuid(),
  runId: z.string().uuid(),
});

export function createMogplexApiAutomationRunCancelHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    cancelRun?: typeof cancelMogplexApiAutomationRun;
  } = {}
) {
  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ automationId: string; runId: string }> }
  ) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: overrides.resolveApiKey ?? resolveApiKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success)
      return mogplexApiError(
        "BAD_REQUEST",
        "automationId and runId must be UUIDs",
        400
      );
    try {
      return mogplexApiSuccess(
        await (overrides.cancelRun ?? cancelMogplexApiAutomationRun)(
          user.userId,
          parsed.data.automationId,
          parsed.data.runId
        )
      );
    } catch (error) {
      return mogplexAutomationErrorResponse(
        error,
        "Failed to cancel automation run"
      );
    }
  };
}

export const POST = createMogplexApiAutomationRunCancelHandler();
