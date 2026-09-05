import type { UIMessage } from "ai";

export type ControlContextUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
};

function tokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Provider usage for the latest individual step, never cumulative billing. */
export function latestControlContext(
  messages: UIMessage[]
): ControlContextUsage | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const metadata = message.metadata as { context?: unknown } | undefined;
    const value = metadata?.context;
    if (!value || typeof value !== "object") return null;
    const usage = value as Record<string, unknown>;
    return typeof usage.model === "string" &&
      tokenCount(usage.inputTokens) &&
      tokenCount(usage.outputTokens)
      ? {
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        }
      : null;
  }
  return null;
}

/** Only emit metadata at meaningful boundaries, not again for every delta. */
export function controlMessageMetadata(
  aiCallId: string,
  model: string,
  part: {
    type: string;
    usage?: { inputTokens?: number; outputTokens?: number };
  }
) {
  if (part.type === "start") return { ai_call_id: aiCallId };
  if (part.type !== "finish-step") return undefined;
  const usage = part.usage;
  return {
    ai_call_id: aiCallId,
    context:
      tokenCount(usage?.inputTokens) && tokenCount(usage?.outputTokens)
        ? {
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          }
        : null,
  };
}
