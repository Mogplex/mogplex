import type { UIMessage } from "ai";

export type ModelContextUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
};

function tokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sameContextModel(actual: string, selected: string | undefined) {
  if (actual === selected) return true;
  // Anthropic returns API ids (claude-sonnet-5-5), while the gateway
  // catalog uses anthropic/claude-sonnet-5.5. Keep other models, providers,
  // and dated versions distinct so a fallback cannot borrow the wrong limit.
  return Boolean(
    selected?.startsWith("anthropic/") &&
    actual.replace(/^anthropic\//, "") ===
      selected.slice("anthropic/".length).replaceAll(".", "-")
  );
}

export function presentModelContext(
  usage: ModelContextUsage | null | undefined,
  model: string | undefined,
  limit: number | undefined
) {
  if (
    !usage ||
    !sameContextModel(usage.model, model) ||
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
    // Older in-memory messages used token-shaped keys. New persisted metadata
    // uses neutral keys so the shared secret sanitizer keeps numeric counts.
    const inputTokens = usage.input ?? usage.inputTokens;
    const outputTokens = usage.output ?? usage.outputTokens;
    return typeof usage.model === "string" &&
      tokenCount(inputTokens) &&
      tokenCount(outputTokens)
      ? {
          model: usage.model,
          inputTokens,
          outputTokens,
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
            input: usage.inputTokens,
            output: usage.outputTokens,
          }
        : null,
  };
}
