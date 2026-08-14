"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Chat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";

function isRunning(chat: Chat<UIMessage>) {
  return chat.status === "submitted" || chat.status === "streaming";
}

type ChatSnapshot = Pick<Chat<UIMessage>, "error" | "messages" | "status">;

class ControlChatRegistry {
  private readonly chats = new Map<string, Chat<UIMessage>>();
  private readonly hydrated = new Set<string>();
  private readonly unsubscribers = new Map<string, () => void>();
  private readonly transport = new DefaultChatTransport<UIMessage>({
    api: "/api/control/chat",
  });

  constructor(
    private readonly onPersist: (
      sessionId: string,
      messages: UIMessage[]
    ) => void,
    private readonly onStatus: (sessionId: string, running: boolean) => void,
    private readonly onSnapshot: (
      sessionId: string,
      chat: Chat<UIMessage>
    ) => void
  ) {}

  get(sessionId: string) {
    const existing = this.chats.get(sessionId);
    if (existing) return existing;

    const chat = new Chat<UIMessage>({
      id: `control-${sessionId}`,
      transport: this.transport,
      sendAutomaticallyWhen:
        lastAssistantMessageIsCompleteWithApprovalResponses,
      onFinish: ({ messages }) => this.onPersist(sessionId, messages),
    });
    this.chats.set(sessionId, chat);
    const unsubscribers = [
      chat["~registerMessagesCallback"](() => this.onSnapshot(sessionId, chat)),
      chat["~registerStatusCallback"](() => {
        this.onStatus(sessionId, isRunning(chat));
        this.onSnapshot(sessionId, chat);
      }),
      chat["~registerErrorCallback"](() => this.onSnapshot(sessionId, chat)),
    ];
    this.unsubscribers.set(sessionId, () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    });
    return chat;
  }

  hydrate(sessionId: string, messages: UIMessage[]) {
    if (this.hydrated.has(sessionId)) return;
    this.get(sessionId).messages = messages;
    this.hydrated.add(sessionId);
  }

  remove(sessionId: string) {
    const existing = this.chats.get(sessionId);
    if (existing) void existing.stop();
    this.unsubscribers.get(sessionId)?.();
    this.unsubscribers.delete(sessionId);
    this.chats.delete(sessionId);
    this.hydrated.delete(sessionId);
    this.onStatus(sessionId, false);
  }

  dispose() {
    for (const unsubscribe of this.unsubscribers.values()) unsubscribe();
    this.unsubscribers.clear();
  }
}

/**
 * Keeps one AI SDK Chat instance per control session. A Chat owns its active
 * response and message state, so retaining the instance lets its stream keep
 * updating while another session is selected.
 */
export function useControlChats({
  activeChatId,
  onPersist,
}: {
  activeChatId: string;
  onPersist: (sessionId: string, messages: UIMessage[]) => void;
}) {
  const [runningSessionIds, setRunningSessionIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [snapshots, setSnapshots] = useState<Record<string, ChatSnapshot>>({});
  const updateRunningState = useCallback(
    (sessionId: string, running: boolean) => {
      setRunningSessionIds((current) => {
        if (current.has(sessionId) === running) return current;
        const next = new Set(current);
        if (running) next.add(sessionId);
        else next.delete(sessionId);
        return next;
      });
    },
    []
  );
  const updateSnapshot = useCallback(
    (sessionId: string, chat: Chat<UIMessage>) => {
      setSnapshots((current) => {
        const previous = current[sessionId];
        if (
          previous?.messages === chat.messages &&
          previous.status === chat.status &&
          previous.error === chat.error
        ) {
          return current;
        }
        return {
          ...current,
          [sessionId]: {
            error: chat.error,
            messages: chat.messages,
            status: chat.status,
          },
        };
      });
    },
    []
  );
  const [registry] = useState(
    () => new ControlChatRegistry(onPersist, updateRunningState, updateSnapshot)
  );
  const activeChat = useMemo(
    () => registry.get(activeChatId),
    [activeChatId, registry]
  );
  const activeSnapshot = snapshots[activeChatId];
  const messages = activeSnapshot?.messages ?? activeChat.messages;
  const status = activeSnapshot?.status ?? activeChat.status;
  const error = activeSnapshot?.error ?? activeChat.error;

  const setSessionMessages = useCallback(
    (sessionId: string, messages: UIMessage[]) => {
      registry.hydrate(sessionId, messages);
    },
    [registry]
  );

  const removeSession = useCallback(
    (sessionId: string) => {
      registry.remove(sessionId);
      setSnapshots((current) => {
        if (!(sessionId in current)) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
    },
    [registry]
  );

  useEffect(() => () => registry.dispose(), [registry]);

  return {
    activeChat,
    messages,
    sendMessage: activeChat.sendMessage,
    status,
    stop: activeChat.stop,
    error,
    clearError: activeChat.clearError,
    addToolApprovalResponse: activeChat.addToolApprovalResponse,
    runningSessionIds,
    setSessionMessages,
    removeSession,
  };
}
