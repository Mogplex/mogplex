import { resolveApiKey } from "@/lib/auth/api-key";
import { mogplexAutomationErrorResponse } from "@/lib/mogplex-api/automation-response";
import { publishMogplexApiAutomation } from "@/lib/mogplex-api/automations";
import {
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import type { NextRequest } from "next/server";

export function createMogplexApiAutomationPublishPostHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    publishAutomation?: typeof publishMogplexApiAutomation;
  } = {}
) {
  const resolveKey = overrides.resolveApiKey ?? resolveApiKey;
  const publishAutomation =
    overrides.publishAutomation ?? publishMogplexApiAutomation;
  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ automationId: string }> }
  ) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: resolveKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;
    try {
      const { automationId } = await params;
      return mogplexApiSuccess({
        automation: await publishAutomation(user.userId, automationId),
      });
    } catch (error) {
      return mogplexAutomationErrorResponse(
        error,
        "Failed to publish automation"
      );
    }
  };
}

export const POST = createMogplexApiAutomationPublishPostHandler();
