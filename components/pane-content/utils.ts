import type { LocalMessage as ConversationLocalMessage } from "@/hooks/use-conversations";

export const EMPTY_LOCAL_MESSAGES: ConversationLocalMessage[] = [];

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
