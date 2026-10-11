"use client";

import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, validateUIMessages, type UIMessage } from "ai";
import { createControlApprovalSubmission } from "@/lib/control/approval-submission";
import { CONTROL_TURN_RUNNING_MESSAGE } from "@/lib/control/turn-conflict";
import { isUuid } from "@/lib/uuid";

function isRunning(chat: Chat<UIMessage>) {
  return chat.status === "submitted" || chat.status === "streaming";
}

export type ChatSnapshot = Pick<
  Chat<UIMessage>,
  "error" | "messages" | "status"
>;

export class ControlChatRegistry {
  private readonly chats = new Map<string, Chat<UIMessage>>();
  private readonly remoteTurns = new Map<string, string>();
  private readonly remoteErrors = new Map<string, Error>();
  private readonly refreshRevisions = new Map<string, number>();
  private readonly hydrated = new Set<string>();
  private readonly persisting = new Set<string>();
  private readonly persistFailed = new Set<string>();
  private readonly archiveReservations = new Set<string>();
  private readonly persistQueues = new Map<string, Promise<void>>();
  private readonly unsubscribers = new Map<string, () => void>();
  private readonly transport = new DefaultChatTransport<UIMessage>({
    api: "/api/control/chat",
    fetch: async (...args) => {
      const response = await globalThis.fetch(...args);
      if (response.status === 409) {
        const body = await response
          .clone()
          .json()
          .catch(() => null);
        if (body?.error === CONTROL_TURN_RUNNING_MESSAGE) {
          throw new Error(CONTROL_TURN_RUNNING_MESSAGE);
        }
      }
      return response;
    },
  });

  constructor(
    private readonly onPersist: (
      sessionId: string,
      messages: UIMessage[]
    ) => Promise<void>,
    private readonly onStatus: (sessionId: string, running: boolean) => void,
    private readonly publishSnapshot: (
      sessionId: string,
      chat: ChatSnapshot
    ) => void,
    private readonly onPersistState: (
      sessionId: string,
      failed: boolean
    ) => void = () => {}
  ) {}

  private onSnapshot(sessionId: string, chat: Chat<UIMessage>) {
    const running = isRunning(chat) || this.remoteTurns.has(sessionId);
    this.onStatus(sessionId, running);
    this.publishSnapshot(sessionId, {
      messages: chat.messages,
      status: running ? "streaming" : chat.status,
      error: chat.error ?? this.remoteErrors.get(sessionId),
    });
  }

  async refreshRemote(sessionId: string) {
    if (!isUuid(sessionId)) return;
    const revision = (this.refreshRevisions.get(sessionId) ?? 0) + 1;
    this.refreshRevisions.set(sessionId, revision);
    const response = await fetch(
      `/api/control/turns?sessionId=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" }
    );
    if (!response.ok) return;
    const data = await response.json();
    const messages =
      data.messages.length === 0
        ? []
        : await validateUIMessages({ messages: data.messages });
    const chat = this.chats.get(sessionId);
    if (
      !chat ||
      this.refreshRevisions.get(sessionId) !== revision ||
      isRunning(chat)
    )
      return;
    const active =
      data.call && ["pending", "streaming"].includes(data.call.status);
    if (active) this.remoteTurns.set(sessionId, data.call.id);
    else this.remoteTurns.delete(sessionId);
    if (typeof data.call?.error === "string")
      this.remoteErrors.set(sessionId, new Error(data.call.error));
    else this.remoteErrors.delete(sessionId);
    this.hydrate(sessionId, messages);
    this.onSnapshot(sessionId, chat);
  }

  async refreshActive(activeId: string) {
    await Promise.all(
      [...new Set([activeId, ...this.remoteTurns.keys()])].map((id) =>
        this.refreshRemote(id).catch((error) => {
          console.error("[control] live turn refresh failed", {
            sessionId: id,
            error,
          });
        })
      )
    );
  }

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
    let stopBeforeAcknowledgement = false;
    const chat = new Chat<UIMessage>({
      id: `control-${sessionId}`,
      transport: this.transport,
      sendAutomaticallyWhen: approvals.shouldSubmit,
      onData: (part) => {
        if (
          part.type !== "data-control-turn" ||
          !part.data ||
          typeof part.data !== "object"
        )
          return;
        const data = part.data as { aiCallId?: string; sessionId?: string };
        if (data.sessionId !== sessionId || !data.aiCallId) return;
        this.remoteTurns.set(sessionId, data.aiCallId);
        this.remoteErrors.delete(sessionId);
        this.onSnapshot(sessionId, chat);
        if (stopBeforeAcknowledgement) {
          void chat.stop().catch((error: Error) => {
            this.remoteErrors.set(sessionId, error);
            this.onSnapshot(sessionId, chat);
          });
        }
      },
      onFinish: ({ messages }) => {
        if (this.remoteTurns.has(sessionId)) {
          // The server saved this request before enqueueing it. Observe the
          // durable run; never write the short acknowledgement as its reply.
          queueMicrotask(() => {
            void this.refreshActive(sessionId);
          });
          return;
        }
        // The SDK also finishes HTTP failures. A rejected turn must never
        // persist its stale transcript over the turn that won admission.
        if (chat.error?.message === CONTROL_TURN_RUNNING_MESSAGE) return;
        void this.persistFinishedMessages(sessionId, messages);
      },
      onError: (error) => {
        if (error.message === CONTROL_TURN_RUNNING_MESSAGE) {
          void this.refreshConflictedTranscript(sessionId, chat, error);
        }
      },
    });
    const sendMessage = chat.sendMessage;
    chat.sendMessage = async (...args) => {
      if (this.remoteTurns.has(sessionId))
        throw new Error(CONTROL_TURN_RUNNING_MESSAGE);
      stopBeforeAcknowledgement = false;
      this.remoteErrors.delete(sessionId);
      this.assertNotArchiving(sessionId);
      if (this.chats.get(sessionId) !== chat)
        throw new Error("This chat is no longer available. Select it again.");
      return sendMessage(...args);
    };
    const stop = chat.stop;
    const { clearError } = chat;
    chat.clearError = () => {
      this.remoteErrors.delete(sessionId);
      clearError();
      this.onSnapshot(sessionId, chat);
    };
    chat.stop = async () => {
      const callId = this.remoteTurns.get(sessionId);
      if (!callId && isRunning(chat)) {
        // Admission may already have succeeded on the server. Keep receiving
        // its acknowledgement so Stop can cancel that run by its durable ID.
        stopBeforeAcknowledgement = true;
        return;
      }
      stopBeforeAcknowledgement = false;
      if (callId) {
        const response = await fetch(
          `/api/observability/calls/${encodeURIComponent(callId)}/cancel`,
          { method: "POST" }
        );
        if (!response.ok && response.status !== 409)
          throw new Error("Could not stop the agent. Try again.");
      }
      await stop();
      if (callId) await this.refreshRemote(sessionId);
    };
    const addApproval = chat.addToolApprovalResponse;
    chat.addToolApprovalResponse = async (response) => {
      this.assertNotArchiving(sessionId);
      if (this.chats.get(sessionId) !== chat)
        throw new Error("This chat is no longer available. Select it again.");
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
        this.onStatus(
          sessionId,
          isRunning(chat) || this.remoteTurns.has(sessionId)
        );
        this.onSnapshot(sessionId, chat);
      }),
      chat["~registerErrorCallback"](() => this.onSnapshot(sessionId, chat)),
    ];
    this.unsubscribers.set(sessionId, () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    });
    return chat;
  }

  private async refreshConflictedTranscript(
    sessionId: string,
    chat: Chat<UIMessage>,
    error: Error
  ) {
    const rejectedMessages = chat.messages;
    try {
      const response = await fetch(
        `/api/control/sessions?id=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("Could not refresh this conversation.");
      const session = await response.json();
      const messages = await validateUIMessages({ messages: session.messages });
      if (
        this.chats.get(sessionId) !== chat ||
        chat.messages !== rejectedMessages ||
        chat.error !== error ||
        isRunning(chat) ||
        this.persisting.has(sessionId) ||
        this.persistFailed.has(sessionId)
      )
        return;
      chat.messages = messages;
      this.hydrated.add(sessionId);
    } catch (refreshError) {
      console.error("[control] could not refresh conflicted conversation", {
        sessionId,
        error: refreshError,
      });
    }
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

  canArchive(sessionId: string) {
    const chat = this.chats.get(sessionId);
    return (
      !this.archiveReservations.has(sessionId) &&
      !this.remoteTurns.has(sessionId) &&
      !(chat && isRunning(chat)) &&
      !this.persisting.has(sessionId) &&
      !this.persistFailed.has(sessionId)
    );
  }

  private assertNotArchiving(sessionId: string) {
    if (this.archiveReservations.has(sessionId)) {
      throw new Error("Wait for the archive to finish.");
    }
  }

  reserveArchive(sessionId: string) {
    if (!this.canArchive(sessionId)) return null;
    this.archiveReservations.add(sessionId);
    return () => {
      this.archiveReservations.delete(sessionId);
    };
  }

  remove(sessionId: string) {
    const existing = this.chats.get(sessionId);
    if (existing) void existing.stop();
    this.unsubscribers.get(sessionId)?.();
    this.unsubscribers.delete(sessionId);
    this.chats.delete(sessionId);
    this.remoteTurns.delete(sessionId);
    this.remoteErrors.delete(sessionId);
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
