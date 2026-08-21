import type { LanguageModelUsage, ProviderMetadata } from "ai";
import {
  appendAiCallEvent,
  buildAiCallCompletionUpdate,
  safeAppendAiCallEvent,
  updateAiCall,
} from "@/lib/interactive-runs";
import { captureUsage } from "@/lib/observability/usage";
import { releaseLimitClaimIfNeeded } from "./context";
import { summarizeToolCalls } from "./telemetry";
import type { ActiveControlCall, ControlChatRunScope } from "./types";

/**
 * Mark a Control run as streaming and emit appropriate events.
 */
export async function markControlRunStreaming(
  activeCall: ActiveControlCall,
  userId: string,
  scope: ControlChatRunScope,
  resolvedModel: string,
  enableTools: boolean
) {
  await appendAiCallEvent({
    aiCallId: activeCall.id,
    userId,
    conversationId: scope.conversationId,
    repoId: scope.repoId,
    eventType: "started",
    message: "Control run started",
    payload: {
      model: resolvedModel,
      tool_enabled: enableTools,
      mission_id: scope.missionId,
    },
  });

  await updateAiCall(activeCall.id, { status: "streaming" });
  await appendAiCallEvent({
    aiCallId: activeCall.id,
    userId,
    conversationId: scope.conversationId,
    repoId: scope.repoId,
    eventType: "status_changed",
    message: "Control run streaming",
    payload: { from: "pending", to: "streaming" },
  });
}

/**
 * Determine the finish state based on finish reason.
 */
export function getControlRunFinishState(
  finishReason: string | null | undefined,
  terminalFailure?: string | null
): {
  status: "success" | "failed";
  error: string | null;
  eventType: "finished" | "failed";
  message: string;
} {
  const status =
    finishReason === "error" || terminalFailure ? "failed" : "success";
  return {
    status,
    error:
      terminalFailure ??
      (finishReason === "error" ? "Stream finished with error" : null),
    eventType: status === "failed" ? "failed" : ("finished" as const),
    message:
      status === "failed" ? "Control run failed" : "Control run finished",
  };
}

/**
 * Translate a sandbox launch result into a terminal-state update.
 * `undefined` preserves the current state for another tool, `null` clears an
 * earlier sandbox failure, and a string records the latest launch failure.
 */
export function getSandboxStartTerminalFailure(event: {
  success: boolean;
  output?: unknown;
  toolCall: { toolName: string };
}): string | null | undefined {
  if (event.toolCall.toolName !== "sandbox_start") return undefined;
  if (!event.success) return "Sandbox startup failed.";
  if (
    event.output === null ||
    typeof event.output !== "object" ||
    Array.isArray(event.output)
  ) {
    return null;
  }
  const output = event.output as Record<string, unknown>;
  if (typeof output.error === "string" || output.status === "error") {
    // Selection and ownership mismatches are expected, recoverable outcomes:
    // the assistant can ask the user for the intended repository or sandbox.
    // Runtime, infrastructure, and configuration failures remain terminal.
    if (
      output.reason === "multiple_sandboxes" ||
      output.reason === "repo_mismatch"
    ) {
      return null;
    }
    return "Sandbox startup failed.";
  }
  return null;
}

/** Keep the terminal state aligned with the most recent sandbox launch. */
export function updateSandboxStartTerminalFailure(
  currentFailure: string | null,
  event: Parameters<typeof getSandboxStartTerminalFailure>[0]
) {
  const nextFailure = getSandboxStartTerminalFailure(event);
  return nextFailure === undefined ? currentFailure : nextFailure;
}

/** Preserve an earlier tool root cause when the response stream also fails. */
export function getControlStreamTerminalFailure(
  terminalFailure: string | null
) {
  return terminalFailure ?? "Control response stream failed.";
}

/**
 * Finalize a Control run that was cancelled (aborted).
 */
export async function finalizeCancelledControlRun(input: {
  activeCall: ActiveControlCall;
  userId: string;
  scope: ControlChatRunScope;
  limitClaimId: string | null;
  callStartedAt: string;
  steps: Array<{
    toolCalls?: Array<{ toolName: string; input?: unknown }>;
    toolResults?: unknown[];
  }>;
}) {
  await releaseLimitClaimIfNeeded(input.userId, input.limitClaimId);

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
    message: "Control run cancelled",
    payload: {
      tool_calls_count: toolCalls.length,
      mission_id: input.scope.missionId,
    },
  });
}

/**
 * Finalize a Control run that completed (success or error).
 */
export async function finalizeFinishedControlRun(input: {
  activeCall: ActiveControlCall;
  userId: string;
  scope: ControlChatRunScope;
  limitClaimId: string | null;
  callStartedAt: string;
  finishReason: string | null | undefined;
  terminalFailure?: string | null;
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
  await releaseLimitClaimIfNeeded(input.userId, input.limitClaimId);

  const toolCalls = summarizeToolCalls(input.steps);
  const completion = getControlRunFinishState(
    input.finishReason,
    input.terminalFailure
  );
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
      mission_id: input.scope.missionId,
    },
  });
}

/**
 * Persist a startup failure to the AI call record.
 */
export async function persistControlStartupFailure(input: {
  aiCall: ActiveControlCall | null;
  userId: string;
  scope: ControlChatRunScope;
  callStartedAt: string;
  limitClaimId: string | null;
  message: string;
}) {
  await releaseLimitClaimIfNeeded(input.userId, input.limitClaimId);

  if (!input.aiCall) return;

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
    console.error("[control/chat] failed to persist startup failure", {
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
    message: "Control run failed before streaming",
    payload: { error: input.message, mission_id: input.scope.missionId },
  });
}
