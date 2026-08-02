import { resolveApiKey } from "@/lib/auth/api-key";
import { mogplexAutomationErrorResponse } from "@/lib/mogplex-api/automation-response";
import { triggerMogplexApiAutomation } from "@/lib/mogplex-api/automations";
import {
  MOGPLEX_API_MAX_IDEMPOTENCY_KEY_LENGTH,
  readMogplexApiIdempotencyKeyResult,
} from "@/lib/mogplex-api/request";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import type { NextRequest } from "next/server";

export function createMogplexApiAutomationTriggerPostHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    triggerAutomation?: typeof triggerMogplexApiAutomation;
  } = {}
) {
  const resolveKey = overrides.resolveApiKey ?? resolveApiKey;
  const triggerAutomation =
    overrides.triggerAutomation ?? triggerMogplexApiAutomation;
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
    const idempotencyKey = readMogplexApiIdempotencyKeyResult(request.headers);
    if (!idempotencyKey.ok) {
      const message =
        idempotencyKey.error === "too_long"
          ? `Idempotency-Key exceeds maximum length of ${MOGPLEX_API_MAX_IDEMPOTENCY_KEY_LENGTH} characters`
          : "Idempotency-Key is required";
      return mogplexApiError("BAD_REQUEST", message, 400);
    }
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body.repoId !== "string" || !body.repoId.trim()) {
      return mogplexApiError("BAD_REQUEST", "repoId is required", 400);
    }
    if (
      body.input !== undefined &&
      (typeof body.input !== "object" ||
        body.input === null ||
        Array.isArray(body.input))
    ) {
      return mogplexApiError("BAD_REQUEST", "input must be an object", 400);
    }
    try {
      const { automationId } = await params;
      const run = await triggerAutomation({
        userId: user.userId,
        automationId,
        repoId: body.repoId.trim(),
        idempotencyKey: idempotencyKey.value,
        input: body.input as Record<string, unknown> | undefined,
      });
      return mogplexApiSuccess({ run }, { status: 202 });
    } catch (error) {
      return mogplexAutomationErrorResponse(
        error,
        "Failed to trigger automation"
      );
    }
  };
}

export const POST = createMogplexApiAutomationTriggerPostHandler();
