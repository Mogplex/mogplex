import { requireUserId } from "@/lib/auth";
import { after } from "next/server";
import { buildLimitResponse, enforceChatLimits } from "@/lib/request-limits";
import {
  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS,
  isModelAllowlistUnavailableError,
} from "@/lib/team-capabilities";
import {
  ControlChatSessionContextError,
  getControlChatRunScope,
  resolveControlChatSessionContext,
  resolveControlChatModelId,
} from "./_lib/context";
import { persistControlStartupFailure } from "./_lib/lifecycle";
import { executeControlChatRequest } from "./_lib/execute";
import {
  ControlChatValidationError,
  validateControlChatMessages,
  readLatestControlUserText,
} from "./_lib/messages";
import {
  resolveInfrastructureDiagnosticScope,
  sanitizeAgentUserFacingError,
} from "@/lib/agents/user-facing-output";
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

  const rawBody = (await req.json()) as ControlChatRequestBody & {
    mode?: unknown;
  };
  if (
    rawBody.mode !== undefined &&
    rawBody.mode !== null &&
    rawBody.mode !== "plan" &&
    rawBody.mode !== "run"
  ) {
    return Response.json(
      { error: "Invalid control chat mode." },
      { status: 400 }
    );
  }
  const hintedBody: ControlChatRequestBody = {
    ...rawBody,
    mode: rawBody.mode ?? null,
  };
  let body: ControlChatRequestBody;
  try {
    body = await resolveControlChatSessionContext(userId, hintedBody);
  } catch (error) {
    const status =
      error instanceof ControlChatSessionContextError ? error.status : 500;
    const message =
      error instanceof ControlChatSessionContextError
        ? error.message
        : "Could not load the Control session context.";
    return Response.json({ error: message }, { status });
  }
  let normalizedMessages;
  try {
    normalizedMessages = await validateControlChatMessages(body.messages);
  } catch (error) {
    if (error instanceof ControlChatValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  const latestUserText = readLatestControlUserText(normalizedMessages);
  const infrastructureDiagnosticScope =
    resolveInfrastructureDiagnosticScope(latestUserText);
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
      infrastructureDiagnosticScope,
      latestUserText,
    });
    if (result.completion) after(result.completion);
    return result.response;
  } catch (error) {
    const internalMessage =
      error instanceof Error ? error.message : "Failed to start control run";
    const message = sanitizeAgentUserFacingError(internalMessage, {
      repoName: body.repoName,
    });
    const aiCall = (error as ControlStartupFailure | null)?.aiCall ?? null;

    await persistControlStartupFailure({
      aiCall,
      userId,
      scope,
      callStartedAt,
      limitClaimId,
      message: internalMessage,
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
