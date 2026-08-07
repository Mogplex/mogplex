import type { OpenAiUsage, TokenUsage } from "./types";
import { stringifyUnknown } from "./message-conversion";

export function toOpenAiFinishReason(reason: string | null | undefined) {
  if (reason === "tool-calls") return "tool_calls";
  if (reason === "content-filter") return "content_filter";
  if (reason === "length") return "length";
  return "stop";
}

export function toOpenAiUsage(usage: TokenUsage): OpenAiUsage | undefined {
  const promptTokens = usage?.inputTokens ?? null;
  const completionTokens = usage?.outputTokens ?? null;
  if (promptTokens == null && completionTokens == null) {
    return undefined;
  }
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: (promptTokens ?? 0) + (completionTokens ?? 0),
  };
}

export function toOpenAiToolCalls(
  toolCalls: Array<{ toolCallId?: string; toolName: string; input: unknown }>
) {
  if (toolCalls.length === 0) return undefined;
  return toolCalls.map((toolCall) => ({
    id: toolCall.toolCallId ?? crypto.randomUUID(),
    type: "function" as const,
    function: {
      name: toolCall.toolName,
      arguments: stringifyUnknown(toolCall.input || {}),
    },
  }));
}
