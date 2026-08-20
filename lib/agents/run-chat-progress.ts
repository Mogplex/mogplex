export type RunChatAgentProgressEvent =
  | { type: "model_working" }
  | {
      type: "text_delta";
      textDelta: string;
      accumulatedText: string;
    }
  | {
      type: "tool_started";
      toolCallId: string;
      toolName: string;
    }
  | {
      type: "tool_finished";
      toolCallId: string;
      toolName: string;
      success: boolean;
    };

export type RunChatAgentProgressCallback = (
  event: RunChatAgentProgressEvent
) => void | Promise<void>;

type ToolCallEvent = {
  toolCall: { toolCallId: string; toolName: string };
};

type ToolCallFinishEvent = ToolCallEvent & { success: boolean };

export function createRunChatProgressReporter(
  onProgress?: RunChatAgentProgressCallback
) {
  let accumulatedText = "";
  let modelWorkingReported = false;

  const emit = async (event: RunChatAgentProgressEvent) => {
    if (!onProgress) return;
    try {
      await onProgress(event);
    } catch (error) {
      console.warn("[run-chat-agent] progress callback failed", error);
    }
  };

  return {
    async modelWorking() {
      if (modelWorkingReported) return;
      modelWorkingReported = true;
      await emit({ type: "model_working" });
    },
    async textDelta(textDelta: string) {
      accumulatedText += textDelta;
      await emit({ type: "text_delta", textDelta, accumulatedText });
    },
    async toolStarted(event: ToolCallEvent) {
      modelWorkingReported = false;
      await emit({
        type: "tool_started",
        toolCallId: event.toolCall.toolCallId,
        toolName: event.toolCall.toolName,
      });
    },
    async toolFinished(event: ToolCallFinishEvent) {
      await emit({
        type: "tool_finished",
        toolCallId: event.toolCall.toolCallId,
        toolName: event.toolCall.toolName,
        success: event.success,
      });
    },
  };
}
