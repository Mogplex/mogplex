import { resolveApiKey } from "@/lib/auth/api-key";
import { mogplexAutomationErrorResponse } from "@/lib/mogplex-api/automation-response";
import { setMogplexApiAutomationModel } from "@/lib/mogplex-api/automations";
import { isMogplexApiModelAvailable } from "@/lib/mogplex-api/models";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import type { NextRequest } from "next/server";

export function createMogplexApiAutomationModelPutHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    setModel?: typeof setMogplexApiAutomationModel;
  } = {}
) {
  const resolveKey = overrides.resolveApiKey ?? resolveApiKey;
  const setModel = overrides.setModel ?? setMogplexApiAutomationModel;
  return async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ automationId: string }> }
  ) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: resolveKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body.nodeId !== "string") {
      return mogplexApiError("BAD_REQUEST", "nodeId is required", 400);
    }
    if (body.modelId !== null && typeof body.modelId !== "string") {
      return mogplexApiError(
        "BAD_REQUEST",
        "modelId must be a model id or null",
        400
      );
    }
    try {
      const { automationId } = await params;
      return mogplexApiSuccess({
        automation: await setModel({
          userId: user.userId,
          automationId,
          nodeId: body.nodeId,
          modelId: body.modelId,
          publish: body.publish === true,
          isModelAvailable: isMogplexApiModelAvailable,
        }),
      });
    } catch (error) {
      return mogplexAutomationErrorResponse(
        error,
        "Failed to update automation model"
      );
    }
  };
}

export const PUT = createMogplexApiAutomationModelPutHandler();
