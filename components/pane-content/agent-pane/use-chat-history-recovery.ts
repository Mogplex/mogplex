"use client";

import { useEffect } from "react";
import type { UIMessage } from "ai";
import { useObservabilityCalls } from "@/hooks/use-observability";
import { useConversationsStore } from "@/hooks/use-conversations";
import {
  needsChatHistoryRecovery,
  reconcileChatHistory,
} from "@/lib/agents/chat-history-recovery";

export function useChatHistoryRecovery(input: {
  paneId: string;
  conversationId: string;
  messages: UIMessage[];
  setMessages: (messages: UIMessage[]) => void;
  enabled: boolean;
}) {
  const { paneId, conversationId, messages, setMessages, enabled } = input;
  const { data } = useObservabilityCalls(
    enabled && messages.some(needsChatHistoryRecovery)
      ? {
          conversationId,
          type: "chat",
          page: 1,
          limit: 100,
          sort: "started_at",
          order: "desc",
        }
      : null
  );

  useEffect(() => {
    if (!enabled || !data) return;
    const store = useConversationsStore.getState();
    if (store.conversations[paneId]?.id !== conversationId) return;
    const next = reconcileChatHistory(messages, data.calls, conversationId);
    if (next === messages) return;
    setMessages(next);
    store.setMessages(paneId, next);
    void store.syncToSupabase(paneId);
  }, [conversationId, data, enabled, messages, paneId, setMessages]);
}
