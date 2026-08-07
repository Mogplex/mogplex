/**
 * Context compaction for the Control chat.
 *
 * When a conversation outgrows the character budget, the older messages are
 * summarized into a single context message so the agent keeps working instead
 * of hitting the model's context limit. The planning here is pure; the actual
 * summarization call lives with the route.
 */

export type CompactableMessage = {
  role: "user" | "assistant" | "system";
  parts: Array<{ type: "text"; text: string }>;
};

export type CompactionPlan =
  | { compact: false }
  | {
      compact: true;
      toSummarize: CompactableMessage[];
      recent: CompactableMessage[];
    };

// ~60k tokens of history before compacting; keeps well under every supported
// model's context window once the system prompt and tools are added.
export const CONTROL_COMPACTION_CHAR_BUDGET = 240_000;

// How many trailing messages survive compaction verbatim.
export const CONTROL_COMPACTION_KEEP_RECENT = 12;

export const COMPACTION_SUMMARY_PREFIX =
  "[Conversation summary — earlier messages were compacted]";

export function estimateMessagesChars(messages: CompactableMessage[]): number {
  let total = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      total += part.text.length;
    }
  }
  return total;
}

export function planCompaction(
  messages: CompactableMessage[],
  options?: { charBudget?: number; keepRecent?: number }
): CompactionPlan {
  const charBudget = options?.charBudget ?? CONTROL_COMPACTION_CHAR_BUDGET;
  const keepRecent = options?.keepRecent ?? CONTROL_COMPACTION_KEEP_RECENT;

  if (estimateMessagesChars(messages) <= charBudget) return { compact: false };
  if (messages.length <= keepRecent) return { compact: false };

  let splitIndex = messages.length - keepRecent;
  // Never let the retained window open with an assistant message: providers
  // reject histories where the first turn after the summary is a reply to a
  // message the model can no longer see.
  while (splitIndex < messages.length && messages[splitIndex].role !== "user") {
    splitIndex += 1;
  }
  if (splitIndex >= messages.length) {
    // No user message in the tail; keep the original window rather than
    // summarizing everything away.
    splitIndex = messages.length - keepRecent;
  }
  if (splitIndex <= 0) return { compact: false };

  return {
    compact: true,
    toSummarize: messages.slice(0, splitIndex),
    recent: messages.slice(splitIndex),
  };
}

export function serializeForSummary(messages: CompactableMessage[]): string {
  return messages
    .map((message) => {
      const text = message.parts.map((part) => part.text).join("\n");
      return `${message.role.toUpperCase()}: ${text}`;
    })
    .join("\n\n");
}

export function buildSummaryMessage(summaryText: string): CompactableMessage {
  return {
    role: "user",
    parts: [
      {
        type: "text",
        text: `${COMPACTION_SUMMARY_PREFIX}\n${summaryText}`,
      },
    ],
  };
}
