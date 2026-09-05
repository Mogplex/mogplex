import type { UIMessage } from "ai";
import type { AiCall } from "@/lib/types";
import {
  needsChatHistoryRecovery,
  savedChatCallId,
} from "./chat-history-recovery";

/** Request only referenced runs, regardless of their age or history length. */
export function buildChatHistoryRequests(
  messages: UIMessage[],
  conversationId: string
): string[] {
  const ids = [
    ...new Set(messages.filter(needsChatHistoryRecovery).map(savedChatCallId)),
  ].filter((id): id is string => id !== null);
  const urls: string[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const params = new URLSearchParams({
      conversation_id: conversationId,
      type: "chat",
      limit: "100",
      call_ids: ids.slice(start, start + 100).join(","),
    });
    urls.push(`/api/observability/calls?${params}`);
  }
  return urls;
}

export async function loadChatHistoryCalls(
  urls: string[],
  request: typeof fetch = fetch
): Promise<AiCall[]> {
  const batches = await Promise.all(
    urls.map(async (url) => {
      const response = await request(url);
      if (!response.ok) throw new Error("Unable to load saved chat run status");
      const data = (await response.json()) as { calls: AiCall[] };
      return data.calls;
    })
  );
  return batches.flat();
}
