import type { UIMessage } from "ai";
import type { FlowGraph } from "@/lib/types";

export const FLOW_ASSISTANT_GRAPH_STATE_TOOL = "getGraphState";
export const FLOW_ASSISTANT_GRAPH_STATE_PART_TYPE = `tool-${FLOW_ASSISTANT_GRAPH_STATE_TOOL}`;
export const FLOW_ASSISTANT_RESULT_DATA_TYPE = "data-flowAssistantResult";

export type FlowAssistantResultData = {
  graph: FlowGraph | null;
  summary: string | null;
  finalized: boolean;
  valid: boolean;
  errors: string[] | null;
};

type MessagePart = UIMessage["parts"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGraphStatePart(part: MessagePart): boolean {
  return part.type === FLOW_ASSISTANT_GRAPH_STATE_PART_TYPE;
}

function isFlowAssistantResultPart(part: MessagePart): boolean {
  return part.type === FLOW_ASSISTANT_RESULT_DATA_TYPE;
}

function isCompletedGraphStatePart(part: MessagePart): boolean {
  if (!isGraphStatePart(part) || !isRecord(part)) return false;
  const record = part as Record<string, unknown>;
  const state = record.state;
  return state === "output-available" || state === "output-error";
}

function shouldKeepGraphStatePart(messages: UIMessage[], index: number) {
  const message = messages[index];
  if (index !== messages.length - 1 || message?.role !== "assistant") {
    return false;
  }
  // Only completed client-tool results can participate in AI SDK automatic
  // continuation. In-progress graph-state parts are dropped intentionally:
  // they contain no graph output yet, so preserving them would add replay
  // payload without giving the SDK a completed result to submit.
  return message.parts.some(isCompletedGraphStatePart);
}

/**
 * Keep the active completed client-tool result needed for AI SDK automatic
 * continuation, but remove every historical graph-bearing part before it is
 * sent again.
 */
export function sanitizeFlowAssistantMessagesForRequest(
  messages: UIMessage[]
): UIMessage[] {
  return messages.map((message, index) => {
    const keepActiveGraphState = shouldKeepGraphStatePart(messages, index);
    const parts = message.parts.filter((part) => {
      if (isFlowAssistantResultPart(part)) return false;
      // The active completed getGraphState output still carries the full graph
      // on the hydration turn. That one-time body is deliberate: AI SDK needs
      // the tool result to reconstruct model context for automatic continuation.
      // Earlier graph-state outputs are stripped so graph size no longer grows
      // with each conversation turn.
      if (isGraphStatePart(part)) return keepActiveGraphState;
      return true;
    });
    return {
      ...message,
      metadata: undefined,
      parts,
    };
  });
}

export function readFlowAssistantResult(
  message: UIMessage
): FlowAssistantResultData | null {
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (!isFlowAssistantResultPart(part) || !isRecord(part)) continue;
    const record = part as Record<string, unknown>;
    const data = record.data;
    if (!isRecord(data)) continue;
    return data as FlowAssistantResultData;
  }
  return null;
}

export function shouldContinueFlowAssistantAfterToolCall({
  messages,
}: {
  messages: UIMessage[];
}): boolean {
  const message = messages[messages.length - 1];
  if (message?.role !== "assistant") return false;
  const lastStepStartIndex = message.parts.reduce(
    (lastIndex, part, index) =>
      part.type === "step-start" ? index : lastIndex,
    -1
  );
  const lastStepGraphStateParts = message.parts
    .slice(lastStepStartIndex + 1)
    .filter((part) => isGraphStatePart(part));
  return (
    lastStepGraphStateParts.length > 0 &&
    lastStepGraphStateParts.every(isCompletedGraphStatePart)
  );
}
