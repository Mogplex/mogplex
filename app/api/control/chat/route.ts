import { requireUserId } from "@/lib/auth";
import { buildLimitResponse, enforceChatLimits } from "@/lib/request-limits";
import {
  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS,
  isModelAllowlistUnavailableError,
} from "@/lib/team-capabilities";
import {
  getControlChatRunScope,
  resolveControlChatModelId,
} from "./_lib/context";
import { persistControlStartupFailure } from "./_lib/lifecycle";
import { executeControlChatRequest } from "./_lib/execute";
import type {
  ControlChatRequestBody,
  ControlStartupFailure,
} from "./_lib/types";

/**
 * POST handler for the Control chat endpoint.
 * Drives the orchestrator agent via the Vercel AI SDK.
 */
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = (await req.json()) as ControlChatRequestBody;
  const scope = getControlChatRunScope(body);

  // Use same rate limiting as /api/chat
  const limitDecision = await enforceChatLimits({
    userId,
    repoId: scope.repoId,
    sandboxId: body.sandboxId ?? null,
  });
  if (!limitDecision.allowed) {
    return buildLimitResponse(limitDecision);
  }

  const limitClaimId = limitDecision.claimId ?? null;
  const callStartedAt = new Date().toISOString();
  const resolvedModel = await resolveControlChatModelId(userId, body.model);

  try {
    const result = await executeControlChatRequest({
      req,
      userId,
      body,
      resolvedModel,
      limitClaimId,
      callStartedAt,
    });
    return result.response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start control run";
    const aiCall = (error as ControlStartupFailure | null)?.aiCall ?? null;

    await persistControlStartupFailure({
      aiCall,
      userId,
      scope,
      callStartedAt,
      limitClaimId,
      message,
    });

    if (isModelAllowlistUnavailableError(error)) {
      return Response.json(
        { error: message },
        {
          status: 503,
          headers: {
            "Retry-After": String(ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS),
          },
        }
      );
    }

    return Response.json({ error: message }, { status: 500 });
  }
}
