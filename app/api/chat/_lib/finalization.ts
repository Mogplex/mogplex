import { releaseLimitClaim } from "@/lib/request-limits";
import {
  buildAiCallCompletionUpdate,
  safeAppendAiCallEvent,
  updateAiCall,
} from "@/lib/interactive-runs";
import { captureUsage } from "@/lib/observability/usage";
import type { LanguageModelUsage, ProviderMetadata } from "ai";
import type { ActiveChatCall, ChatRunScope } from "./types";
import { summarizeToolCalls } from "./events";

export async function releaseChatLimitClaimIfNeeded(
  userId: string,
  limitClaimId: string | null
) {
  if (!limitClaimId) {
    return;
  }

  await releaseLimitClaim({
    userId,
    routeKey: "chat",
    claimId: limitClaimId,
  });
}

export function getChatRunFinishState(
  finishReason: string | null | undefined
): {
  status: "success" | "failed";
  error: string | null;
  eventType: "finished" | "failed";
  message: string;
} {
  const status = finishReason === "error" ? "failed" : "success";
  return {
    status,
    error: finishReason === "error" ? "Stream finished with error" : null,
    eventType: status === "failed" ? "failed" : ("finished" as const),
    message: status === "failed" ? "Chat run failed" : "Chat run finished",
  };
}

export async function finalizeCancelledChatRun(input: {
  activeCall: ActiveChatCall;
  userId: string;
  scope: ChatRunScope;
  limitClaimId: string | null;
  callStartedAt: string;
  steps: Array<{
    toolCalls?: Array<{ toolName: string; input?: unknown }>;
    toolResults?: unknown[];
  }>;
}) {
  await releaseChatLimitClaimIfNeeded(input.userId, input.limitClaimId);

  const toolCalls = summarizeToolCalls(input.steps);
  await updateAiCall(
    input.activeCall.id,
    buildAiCallCompletionUpdate({
      startedAt: input.callStartedAt,
      status: "cancelled",
      toolCalls,
      metadata: input.activeCall.metadata,
    })
  );
  await safeAppendAiCallEvent({
    aiCallId: input.activeCall.id,
    userId: input.userId,
    conversationId: input.scope.conversationId,
    repoId: input.scope.repoId,
    eventType: "cancelled",
    message: "Chat run cancelled",
    payload: {
      tool_calls_count: toolCalls.length,
    },
  });
}

export async function finalizeFinishedChatRun(input: {
  activeCall: ActiveChatCall;
  userId: string;
  scope: ChatRunScope;
  limitClaimId: string | null;
  callStartedAt: string;
  finishReason: string | null | undefined;
  totalUsage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
  } | null;
  providerMetadata?: ProviderMetadata;
  steps: Array<{
    toolCalls?: Array<{ toolName: string; input?: unknown }>;
    toolResults?: unknown[];
  }>;
}) {
  await releaseChatLimitClaimIfNeeded(input.userId, input.limitClaimId);

  const toolCalls = summarizeToolCalls(input.steps);
  const completion = getChatRunFinishState(input.finishReason);
  const usage = captureUsage(
    input.totalUsage as LanguageModelUsage | undefined,
    input.providerMetadata
  );

  await updateAiCall(
    input.activeCall.id,
    buildAiCallCompletionUpdate({
      startedAt: input.callStartedAt,
      status: completion.status,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      reasoningTokens: usage.reasoningTokens,
      gatewayGenerationId: usage.generationId,
      error: completion.error,
      toolCalls,
      metadata: input.activeCall.metadata,
    })
  );
  await safeAppendAiCallEvent({
    aiCallId: input.activeCall.id,
    userId: input.userId,
    conversationId: input.scope.conversationId,
    repoId: input.scope.repoId,
    eventType: completion.eventType,
    message: completion.message,
    payload: {
      finish_reason: input.finishReason,
      tool_calls_count: toolCalls.length,
      total_tokens:
        (input.totalUsage?.inputTokens ?? 0) +
        (input.totalUsage?.outputTokens ?? 0),
      error: completion.error,
    },
  });
}

export async function persistChatStartupFailure(input: {
  aiCall: ActiveChatCall | null;
  userId: string;
  scope: ChatRunScope;
  callStartedAt: string;
  limitClaimId: string | null;
  message: string;
}) {
  await releaseChatLimitClaimIfNeeded(input.userId, input.limitClaimId);

  if (!input.aiCall) {
    return;
  }

  try {
    await updateAiCall(
      input.aiCall.id,
      buildAiCallCompletionUpdate({
        startedAt: input.callStartedAt,
        status: "failed",
        error: input.message,
        metadata: input.aiCall.metadata,
      })
    );
  } catch (persistError) {
    console.error("[chat] failed to persist startup failure", {
      aiCallId: input.aiCall.id,
      persistError,
    });
  }

  await safeAppendAiCallEvent({
    aiCallId: input.aiCall.id,
    userId: input.userId,
    conversationId: input.scope.conversationId,
    repoId: input.scope.repoId,
    eventType: "failed",
    message: "Chat run failed before streaming",
    payload: { error: input.message },
  });
}
