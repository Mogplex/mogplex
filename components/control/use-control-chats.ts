"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { createControlApprovalSubmission } from "@/lib/control/approval-submission";

function isRunning(chat: Chat<UIMessage>) {
  return chat.status === "submitted" || chat.status === "streaming";
}

type ChatSnapshot = Pick<Chat<UIMessage>, "error" | "messages" | "status">;

export class ControlChatRegistry {
  private readonly chats = new Map<string, Chat<UIMessage>>();
  private readonly hydrated = new Set<string>();
  private readonly persisting = new Set<string>();
  private readonly persistFailed = new Set<string>();
  private readonly persistQueues = new Map<string, Promise<void>>();
  private readonly unsubscribers = new Map<string, () => void>();
  private readonly transport = new DefaultChatTransport<UIMessage>({
    api: "/api/control/chat",
  });

  constructor(
    private readonly onPersist: (
      sessionId: string,
      messages: UIMessage[]
    ) => Promise<void>,
    private readonly onStatus: (sessionId: string, running: boolean) => void,
    private readonly onSnapshot: (
      sessionId: string,
      chat: Chat<UIMessage>
    ) => void,
    private readonly onPersistState: (
      sessionId: string,
      failed: boolean
    ) => void = () => {}
  ) {}

  async persistFinishedMessages(sessionId: string, messages: UIMessage[]) {
    const previous = this.persistQueues.get(sessionId);
    let operation: Promise<void>;
    operation = (previous ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (this.persistQueues.get(sessionId) !== operation) return;
        await this.onPersist(sessionId, messages);
      });
    this.persistQueues.set(sessionId, operation);
    this.persisting.add(sessionId);
    try {
      await operation;
      if (this.persistQueues.get(sessionId) === operation) {
        this.persistFailed.delete(sessionId);
        this.onPersistState(sessionId, false);
      }
    } catch (error) {
      if (this.persistQueues.get(sessionId) === operation) {
        this.persistFailed.add(sessionId);
        this.onPersistState(sessionId, true);
        console.error("[control] failed to persist chat", {
          sessionId,
          error,
        });
      }
    } finally {
      if (this.persistQueues.get(sessionId) === operation) {
        this.persistQueues.delete(sessionId);
        this.persisting.delete(sessionId);
      }
    }
  }

  get(sessionId: string) {
    const existing = this.chats.get(sessionId);
    if (existing) return existing;

    const approvals = createControlApprovalSubmission();
    const chat = new Chat<UIMessage>({
      id: `control-${sessionId}`,
      transport: this.transport,
      sendAutomaticallyWhen: approvals.shouldSubmit,
      onFinish: ({ messages }) => {
        void this.persistFinishedMessages(sessionId, messages);
      },
    });
    const addApproval = chat.addToolApprovalResponse;
    chat.addToolApprovalResponse = async (response) => {
      approvals.request(chat.messages, response.id);
      await addApproval(response);
    };
    this.chats.set(sessionId, chat);
    // The public useChat hook owns one Chat at a time, so this registry uses
    // the installed @ai-sdk/react Chat store callbacks to observe N retained
    // instances. On SDK upgrades, verify these tilde-prefixed names and their
    // callback timing with control-chat-registry.test.ts.
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
    const chat = this.get(sessionId);
    // Preserve local messages after any failed write, including a permanent
    // rejection such as a remotely archived session, so they can be copied.
    if (
      this.hydrated.has(sessionId) &&
      (isRunning(chat) ||
        this.persisting.has(sessionId) ||
        this.persistFailed.has(sessionId))
    ) {
      return false;
    }
    chat.messages = messages;
    this.hydrated.add(sessionId);
    return true;
  }

  remove(sessionId: string) {
    const existing = this.chats.get(sessionId);
    if (existing) void existing.stop();
    this.unsubscribers.get(sessionId)?.();
    this.unsubscribers.delete(sessionId);
    this.chats.delete(sessionId);
    this.hydrated.delete(sessionId);
    this.persisting.delete(sessionId);
    this.persistFailed.delete(sessionId);
    this.persistQueues.delete(sessionId);
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
    setSessionMessages,
    removeSession,
  };
}
