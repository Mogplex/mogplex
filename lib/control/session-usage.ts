import type { UIMessage } from "ai";

export type SessionUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export const EMPTY_SESSION_USAGE: SessionUsage = {
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
};

/**
 * Pull the ai_call ids streamed as message metadata by the control chat
 * endpoint (`messageMetadata: () => ({ ai_call_id })`). Metadata persists
 * with the session's UIMessages, so restored conversations re-derive the
 * same ids. Order-stable and deduplicated.
 */
export function extractAiCallIds(messages: UIMessage[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const metadata = message.metadata as { ai_call_id?: unknown } | undefined;
    const id = metadata?.ai_call_id;
    if (typeof id === "string" && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Compact token counts: 950 → "950", 45210 → "45.2k", 2_340_000 → "2.3M". */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
