import type { UIMessage } from "ai";

export type ModelContextUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
};

function tokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function presentModelContext(
  usage: ModelContextUsage | null | undefined,
  model: string | undefined,
  limit: number | undefined
) {
  if (
    !usage ||
    usage.model !== model ||
    !tokenCount(usage.inputTokens) ||
    !tokenCount(usage.outputTokens) ||
    !limit ||
    !Number.isFinite(limit) ||
    limit < 0
  ) {
    return {
      label: "Context: unknown",
      title:
        "Context usage has not been measured for this model. Chat length and session token totals are not context usage.",
    };
  }
  const used = usage.inputTokens + usage.outputTokens;
  const percent = Math.min(100, Math.ceil((used / limit) * 100));
  return {
    label: `Context: ${percent}% used`,
    title: `Last model step: ${used.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} tokens. Context can change as the run continues.`,
  };
}

/** Provider usage for the latest individual step, never cumulative billing. */
export function latestModelContext(
  messages: UIMessage[]
): ModelContextUsage | null {
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
export function modelMessageMetadata(
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
