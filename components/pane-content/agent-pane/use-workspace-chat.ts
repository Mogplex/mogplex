"use client";

import { useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import {
  markInterruptedChatResponse,
  WorkspaceChatTransport,
} from "@/lib/agents/chat-stream";

export function useWorkspaceChat(id: string, messages: UIMessage[]) {
  const transport = useMemo(
    () =>
      new WorkspaceChatTransport({
        api: "/api/chat",
        headers: () => getActiveTeamRequestHeaders(),
      }),
    []
  );
  const chat = useChat({
    id,
    messages,
    transport,
    onFinish({ message, isAbort, isDisconnect, isError }) {
      if (isAbort || isDisconnect || isError) {
        chat.setMessages((current) =>
          markInterruptedChatResponse(current, message.id)
        );
      }
    },
  });
  return chat;
}
