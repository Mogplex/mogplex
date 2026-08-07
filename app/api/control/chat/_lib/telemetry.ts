import {
  previewTelemetryValue,
  sanitizeTelemetryValue as sanitizeToolPayload,
} from "@/lib/ai-telemetry";
import { safeAppendAiCallEvent } from "@/lib/interactive-runs";
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
export function createToolCallFinishPayload(event: {
  success: boolean;
  output?: unknown;
  error?: unknown;
  durationMs?: number | null;
  stepNumber?: number | null;
  toolCall: { input?: unknown; toolCallId: string; toolName: string };
}) {
  const input = sanitizeToolPayload(event.toolCall.input);
  const output = event.success ? sanitizeToolPayload(event.output) : undefined;
  const error = event.success
    ? null
    : event.error instanceof Error
      ? event.error.message
      : String(event.error);

  return {
    message: event.success
      ? `Tool finished: ${event.toolCall.toolName}`
      : `Tool failed: ${event.toolCall.toolName}`,
    payload: {
      tool_call_id: event.toolCall.toolCallId,
      input,
      input_preview: previewTelemetryValue(input),
      ...(event.success
        ? {
            output,
            output_preview: previewTelemetryValue(output),
          }
        : {
            error,
          }),
      duration_ms: event.durationMs,
      success: event.success,
      step_number: event.stepNumber ?? null,
    },
  };
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
    const input = sanitizeToolPayload(event.toolCall.input);
    void safeAppendAiCallEvent({
      aiCallId: activeCall.id,
      userId,
      conversationId: scope.conversationId,
      repoId: scope.repoId,
      eventType: "tool_started",
      toolName: event.toolCall.toolName,
      message: `Tool started: ${event.toolCall.toolName}`,
      payload: {
        tool_call_id: event.toolCall.toolCallId,
        input,
        input_preview: previewTelemetryValue(input),
        step_number: event.stepNumber ?? null,
        mission_id: scope.missionId,
      },
    });
  };
}

/**
 * Create a handler for tool call finish events.
 */
export function createToolCallFinishHandler(
  activeCall: ActiveControlCall,
  userId: string,
  scope: ControlChatRunScope
) {
  return function handleToolCallFinish(event: {
    success: boolean;
    output?: unknown;
    error?: unknown;
    durationMs?: number | null;
    stepNumber?: number | null;
    toolCall: { input?: unknown; toolCallId: string; toolName: string };
  }) {
    const finished = createToolCallFinishPayload(event);
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
