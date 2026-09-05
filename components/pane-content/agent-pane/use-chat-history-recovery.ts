"use client";

import { useEffect, useMemo } from "react";
import useSWR from "swr";
import type { UIMessage } from "ai";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import { USER_AI_CALLS_REALTIME_SPEC } from "@/lib/observability/realtime-specs";
import {
  buildChatHistoryRequests,
  loadChatHistoryCalls,
} from "@/lib/agents/chat-history-requests";
import { useConversationsStore } from "@/hooks/use-conversations";
import { reconcileChatHistory } from "@/lib/agents/chat-history-recovery";

export function useChatHistoryRecovery(input: {
  paneId: string;
  conversationId: string;
  messages: UIMessage[];
  setMessages: (messages: UIMessage[]) => void;
  enabled: boolean;
}) {
  const { paneId, conversationId, messages, setMessages, enabled } = input;
  const urls = useMemo(
    () => (enabled ? buildChatHistoryRequests(messages, conversationId) : []),
    [conversationId, enabled, messages]
  );
  const { data, mutate } = useSWR(
    urls.length > 0 ? urls : null,
    (requests: string[]) => loadChatHistoryCalls(requests),
    { shouldRetryOnError: false }
  );
  useRealtimeRouteRefresh({
    channelName: `chat-history:${conversationId}`,
    specs: [USER_AI_CALLS_REALTIME_SPEC],
    onInvalidate: mutate,
    enabled: urls.length > 0,
  });

  useEffect(() => {
    if (!enabled || !data) return;
    const store = useConversationsStore.getState();
    if (store.conversations[paneId]?.id !== conversationId) return;
    const next = reconcileChatHistory(messages, data, conversationId);
    if (next === messages) return;
    setMessages(next);
    store.setMessages(paneId, next);
    void store.syncToSupabase(paneId);
  }, [conversationId, data, enabled, messages, paneId, setMessages]);
}
