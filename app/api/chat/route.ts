import { resolveChatModelId } from "@/lib/agents/run-chat";
import { requireUserId } from "@/lib/auth";
import { buildLimitResponse, enforceChatLimits } from "@/lib/request-limits";
import {
  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS,
  isModelAllowlistUnavailableError,
} from "@/lib/team-capabilities";

import type {
  ChatPostDeps,
  ChatRequestBody,
  ChatStartupFailure,
} from "./_lib/types";
import { getChatRunScope } from "./_lib/types";
import { persistChatStartupFailure } from "./_lib/finalization";
import { executeChatRequest } from "./_lib/execute";
import {
  ChatSessionContextError,
  resolveChatSessionContext,
} from "./_lib/session-context";
import { ChatValidationError, normalizeChatMessages } from "./_lib/messages";

// Re-export test helpers from memory module
export {
  buildMemoryQueryFromMessages,
  buildMemoryContextSection,
} from "./_lib/memory";

const defaultChatPostDeps: ChatPostDeps = {
  requireUserId,
  enforceChatLimits,
  resolveChatSessionContext,
};

export function createChatPostHandler(overrides: Partial<ChatPostDeps> = {}) {
  const deps: ChatPostDeps = {
    ...defaultChatPostDeps,
    ...overrides,
  };

  return async function POST(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    if (
      parsedBody === null ||
      typeof parsedBody !== "object" ||
      Array.isArray(parsedBody)
    ) {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const hintedBody = parsedBody as ChatRequestBody;

    let body: ChatRequestBody;
    try {
      body = await deps.resolveChatSessionContext(req, userId, hintedBody);
    } catch (error) {
      const status =
        error instanceof ChatSessionContextError ? error.status : 500;
      const message =
        error instanceof ChatSessionContextError
          ? error.message
          : "Could not load the conversation context.";
      return Response.json({ error: message }, { status });
    }
    try {
      body.messages = normalizeChatMessages(body.messages);
    } catch (error) {
      if (error instanceof ChatValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    const scope = getChatRunScope(body);

    const limitDecision = await deps.enforceChatLimits({
      userId,
      repoId: scope.repoId,
      sandboxId: body.sandboxId ?? null,
    });
    if (!limitDecision.allowed) {
      return buildLimitResponse(limitDecision);
    }

    const limitClaimId = limitDecision.claimId ?? null;
    const callStartedAt = new Date().toISOString();
    const resolvedModel = await resolveChatModelId(userId, body.model);

    try {
      const result = await executeChatRequest({
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
        error instanceof Error ? error.message : "Failed to start chat run";
      const aiCall = (error as ChatStartupFailure | null)?.aiCall ?? null;

      await persistChatStartupFailure({
        aiCall,
        userId,
        scope,
        callStartedAt,
        limitClaimId,
        message,
      });

      // 503 + Retry-After for an unreadable team allowlist, matching the other
      // resolver surfaces: the failure is transient and its own copy says to
      // try again, so a 500 (which reads as a bug) would mislead the client.
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
  };
}

export const POST = createChatPostHandler();
