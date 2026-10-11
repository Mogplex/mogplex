"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import {
  ControlChatRegistry,
  type ChatSnapshot,
} from "./control-chat-registry";

export { ControlChatRegistry } from "./control-chat-registry";

const TURN_EVENTS = [
  { table: "ai_calls", filter: "user_id=eq.$USER_ID" },
  { table: "control_sessions", filter: "user_id=eq.$USER_ID" },
];

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
  onPersist: (sessionId: string, messages: UIMessage[]) => Promise<void>;
}) {
  const [runningSessionIds, setRunningSessionIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [snapshots, setSnapshots] = useState<Record<string, ChatSnapshot>>({});
  const [persistErrors, setPersistErrors] = useState<ReadonlySet<string>>(
    () => new Set()
  );
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
    (sessionId: string, chat: ChatSnapshot) => {
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
  const recordPersistState = useCallback(
    (sessionId: string, failed: boolean) => {
      setPersistErrors((current) => {
        if (current.has(sessionId) === failed) return current;
        const next = new Set(current);
        if (failed) next.add(sessionId);
        else next.delete(sessionId);
        return next;
      });
    },
    []
  );
  const [registry] = useState(
    () =>
      new ControlChatRegistry(
        onPersist,
        updateRunningState,
        updateSnapshot,
        recordPersistState
      )
  );
  const activeChat = useMemo(
    () => registry.get(activeChatId),
    [activeChatId, registry]
  );
  const refreshRemote = useCallback(
    () => registry.refreshActive(activeChatId),
    [registry, activeChatId]
  );
  useRealtimeRouteRefresh({
    channelName: "control-durable-turns",
    specs: TURN_EVENTS,
    onInvalidate: refreshRemote,
  });
  useEffect(() => {
    void refreshRemote();
  }, [refreshRemote]);
  const activeSnapshot = snapshots[activeChatId];
  const messages = activeSnapshot?.messages ?? activeChat.messages;
  const status = activeSnapshot?.status ?? activeChat.status;
  const error = activeSnapshot?.error ?? activeChat.error;

  const setSessionMessages = useCallback(
    (sessionId: string, messages: UIMessage[]) =>
      registry.hydrate(sessionId, messages),
    [registry]
  );

  const removeSession = useCallback(
    (sessionId: string) => {
      registry.remove(sessionId);
      setPersistErrors((current) => {
        if (!current.has(sessionId)) return current;
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
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
    persistError: persistErrors.has(activeChatId)
      ? "This chat finished, but its messages could not be saved. They remain available in this tab. Copy them before closing; sending another message retries saving."
      : null,
    clearError: activeChat.clearError,
    addToolApprovalResponse: activeChat.addToolApprovalResponse,
    runningSessionIds,
    reserveArchiveSession: (id: string) => registry.reserveArchive(id),
    setSessionMessages,
    removeSession,
  };
}
