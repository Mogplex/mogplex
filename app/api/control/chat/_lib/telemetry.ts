import {
  previewTelemetryValue,
  sanitizeTelemetryValue as sanitizeToolPayload,
} from "@/lib/ai-telemetry";
import {
  mergeAiCallMetadata,
  safeAppendAiCallEvent,
} from "@/lib/interactive-runs";
import {
  buildResourceContextTelemetry,
  buildResourceDecisionTelemetry,
  isOrchestratorResourceTool,
  type ResourceContextScope,
} from "@/lib/agents/orchestrator/resource-telemetry";
import type {
  ControlPromptSandboxContext,
  ControlPromptWorktreeContext,
} from "./context";
import type { ActiveControlCall, ControlChatRunScope } from "./types";

/**
 * Summarize tool calls from steps for the AI call completion record.
 */
export function summarizeToolCalls(
  steps: Array<{
    toolCalls?: Array<{ toolName: string; input?: unknown }>;
    toolResults?: unknown[];
  }>
) {
  return steps.flatMap((step) =>
    (step.toolCalls || []).map((toolCall, index) => {
      if (isOrchestratorResourceTool(toolCall.toolName)) {
        return {
          name: toolCall.toolName,
          resource_payload_omitted: true,
        };
      }
      const input = sanitizeToolPayload(toolCall.input);
      const output = sanitizeToolPayload(step.toolResults?.[index]);

      return {
        name: toolCall.toolName,
        input,
        output,
        input_preview: previewTelemetryValue(input),
        output_preview: previewTelemetryValue(output),
      };
    })
  );
}

/**
 * Build payload for a tool call finish event.
 */
export function createToolCallFinishPayload(
  event: {
    success: boolean;
    output?: unknown;
    error?: unknown;
    durationMs?: number | null;
    stepNumber?: number | null;
    toolCall: { input?: unknown; toolCallId: string; toolName: string };
  },
  resourceScope?: ResourceContextScope
) {
  const resourceTool = isOrchestratorResourceTool(event.toolCall.toolName);
  const input = sanitizeToolPayload(event.toolCall.input);
  const output = event.success ? sanitizeToolPayload(event.output) : undefined;
  const error = event.success
    ? null
    : event.error instanceof Error
      ? event.error.message
      : String(event.error);
  const resourceDecision = resourceScope
    ? buildResourceDecisionTelemetry(event, resourceScope)
    : null;

  return {
    message: event.success
      ? `Tool finished: ${event.toolCall.toolName}`
      : `Tool failed: ${event.toolCall.toolName}`,
    payload: {
      tool_call_id: event.toolCall.toolCallId,
      ...(resourceTool
        ? { resource_payload_omitted: true }
        : {
            input,
            input_preview: previewTelemetryValue(input),
            ...(event.success
              ? {
                  output,
                  output_preview: previewTelemetryValue(output),
                }
              : { error }),
          }),
      duration_ms: event.durationMs,
      success: event.success,
      step_number: event.stepNumber ?? null,
      ...(resourceDecision ? { resource_decision: resourceDecision } : {}),
    },
  };
}

export function createToolCallStartPayload(
  event: {
    toolCall: { input?: unknown; toolCallId: string; toolName: string };
    stepNumber?: number | null;
  },
  missionId: string | null
) {
  const resourceTool = isOrchestratorResourceTool(event.toolCall.toolName);
  const input = resourceTool
    ? undefined
    : sanitizeToolPayload(event.toolCall.input);
  return {
    tool_call_id: event.toolCall.toolCallId,
    ...(resourceTool
      ? { resource_payload_omitted: true }
      : {
          input,
          input_preview: previewTelemetryValue(input),
        }),
    step_number: event.stepNumber ?? null,
    mission_id: missionId,
  };
}

export function buildControlResourceContextPayload(input: {
  scope: ControlChatRunScope;
  sandboxContext: ControlPromptSandboxContext;
  worktreeContext: ControlPromptWorktreeContext;
}) {
  return buildResourceContextTelemetry({
    scope: {
      repoId: input.scope.repoId,
      missionId: input.scope.missionId,
      orchestrationRunId: input.worktreeContext.orchestrationRunId,
      selectedSandboxId: input.sandboxContext.selected?.recordId ?? null,
    },
    sandbox: {
      decisionSource: input.sandboxContext.decisionSource,
      rejectionReason: input.sandboxContext.rejectionReason,
      recordId: input.sandboxContext.selected?.recordId ?? null,
      runtimeId: input.sandboxContext.selected?.runtimeId ?? null,
    },
    worktrees: {
      decisionSource: input.worktreeContext.decisionSource,
      rejectionReason: input.worktreeContext.rejectionReason,
      total: input.worktreeContext.worktrees.length,
      items: input.worktreeContext.worktrees.map((worktree) => ({
        worktreeId: worktree.id,
        taskId: worktree.taskId,
        sandboxRecordId: worktree.sandboxId,
        checkoutPath: worktree.checkoutPath,
      })),
    },
  });
}

export function buildControlResourceMetadataPatch(
  payload: ReturnType<typeof buildControlResourceContextPayload>
) {
  return {
    sandbox_id: payload.sandbox.record_id,
    sandbox_runtime_id: payload.sandbox.runtime_id,
    sandbox_selection_source: payload.sandbox.decision_source,
    sandbox_rejection_reason: payload.sandbox.rejection_reason,
    mission_id: payload.mission_id,
    orchestration_run_id: payload.orchestration_run_id,
  };
}

/** Persist a bounded, machine-readable snapshot for resource qualification. */
export async function recordControlResourceContext(input: {
  activeCall: ActiveControlCall;
  userId: string;
  scope: ControlChatRunScope;
  sandboxContext: ControlPromptSandboxContext;
  worktreeContext: ControlPromptWorktreeContext;
}) {
  const payload = buildControlResourceContextPayload(input);
  const metadataPatch = buildControlResourceMetadataPatch(payload);
  // Completion persists this in-memory snapshot again, so keep it aligned with
  // the atomic database merge instead of allowing validated IDs to be erased.
  input.activeCall.metadata = {
    ...input.activeCall.metadata,
    ...metadataPatch,
  };
  await Promise.all([
    safeAppendAiCallEvent({
      aiCallId: input.activeCall.id,
      userId: input.userId,
      conversationId: input.scope.conversationId,
      repoId: input.scope.repoId,
      eventType: "log",
      message: "Orchestrator resource context resolved",
      payload,
    }),
    mergeAiCallMetadata({
      aiCallId: input.activeCall.id,
      userId: input.userId,
      metadata: metadataPatch,
    }).catch((error: unknown) => {
      console.error("[control] failed to merge resource metadata", {
        aiCallId: input.activeCall.id,
        error,
      });
      return null;
    }),
  ]);
}

/**
 * Create a handler for tool call start events.
 */
export function createToolCallStartHandler(
  activeCall: ActiveControlCall,
  userId: string,
  scope: ControlChatRunScope
) {
  return function handleToolCallStart(event: {
    toolCall: { input?: unknown; toolCallId: string; toolName: string };
    stepNumber?: number | null;
  }) {
    void safeAppendAiCallEvent({
      aiCallId: activeCall.id,
      userId,
      conversationId: scope.conversationId,
      repoId: scope.repoId,
      eventType: "tool_started",
      toolName: event.toolCall.toolName,
      message: `Tool started: ${event.toolCall.toolName}`,
      payload: createToolCallStartPayload(event, scope.missionId),
    });
  };
}

/**
 * Create a handler for tool call finish events.
 */
export function createToolCallFinishHandler(
  activeCall: ActiveControlCall,
  userId: string,
  scope: ControlChatRunScope,
  resourceScope?: ResourceContextScope
) {
  return function handleToolCallFinish(event: {
    success: boolean;
    output?: unknown;
    error?: unknown;
    durationMs?: number | null;
    stepNumber?: number | null;
    toolCall: { input?: unknown; toolCallId: string; toolName: string };
  }) {
    const finished = createToolCallFinishPayload(event, resourceScope);
    void safeAppendAiCallEvent({
      aiCallId: activeCall.id,
      userId,
      conversationId: scope.conversationId,
      repoId: scope.repoId,
      eventType: "tool_finished",
      toolName: event.toolCall.toolName,
      message: finished.message,
      payload: finished.payload,
    });
  };
}
