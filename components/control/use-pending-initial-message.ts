"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPendingInitialMessageDeadline,
  FIRST_MESSAGE_FAILURE,
  loadPendingInitialMessage,
  removePendingInitialMessage,
  savePendingInitialMessage,
  type PendingInitialMessage,
} from "@/lib/control/pending-initial-message";
import {
  buildControlChatBody,
  buildControlChatMessage,
  type ControlChatRequestContext,
} from "./control-chat-request";

type SendMessage = (
  message: ReturnType<typeof buildControlChatMessage> & { messageId?: string },
  options: { body: ReturnType<typeof buildControlChatBody> }
) => Promise<void>;

/** Queue before the chat is re-keyed, and retain the draft until a successful send. */
export function usePendingInitialMessage({
  selectedMissionId,
  status,
  sendMessage,
  getChatError,
  clearChatError,
  messages,
  requestContext,
}: {
  selectedMissionId: string;
  status: string;
  sendMessage: SendMessage;
  getChatError: () => Error | undefined;
  clearChatError: () => void;
  messages: Array<{ id: string; role: string }>;
  requestContext: ControlChatRequestContext;
}) {
  const [pending, setPending] = useState<PendingInitialMessage | null>(null);
  const pendingRef = useRef<PendingInitialMessage | null>(null);
  const sendingRef = useRef(new Set<string>());
  const queue = useCallback(async (next: PendingInitialMessage) => {
    const queued = { ...next, failed: false, queuedAt: Date.now() };
    pendingRef.current = queued;
    try {
      await savePendingInitialMessage(window.sessionStorage, queued);
    } catch (error) {
      setPending({ ...queued, failed: true });
      throw error;
    }
    setPending(queued);
  }, []);

  useEffect(() => {
    if (
      !selectedMissionId ||
      pendingRef.current?.missionId === selectedMissionId
    )
      return;
    let current = true;
    void loadPendingInitialMessage(window.sessionStorage, selectedMissionId)
      .then((stored) => (current && stored ? queue(stored) : undefined))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [selectedMissionId, queue]);
  useEffect(() => {
    if (pending?.missionId !== selectedMissionId || pending.failed) return;
    const failed = () => {
      const next = { ...pending, failed: true };
      void savePendingInitialMessage(window.sessionStorage, next).catch(
        () => undefined
      );
      setPending((current) =>
        current?.missionId === pending.missionId ? next : current
      );
    };
    if (status !== "ready") {
      const deadline = createPendingInitialMessageDeadline(
        failed,
        pending.queuedAt
      );
      deadline.updateStatus(status);
      return deadline.cancel;
    }
    if (sendingRef.current.has(pending.missionId)) return;
    sendingRef.current.add(pending.missionId);
    clearChatError();
    // Replace a failed first user turn on Retry rather than append it twice.
    const previous = messages.find((message) => message.role === "user");
    void sendMessage(
      {
        ...buildControlChatMessage(pending.text, pending.options),
        ...(previous ? { messageId: previous.id } : {}),
      },
      {
        body: buildControlChatBody({
          model: pending.options.model,
          scope: pending.options.mode === "plan" ? "PLAN ONLY" : "IMPLEMENT",
          target: "mission",
          permissions: pending.options.permissions,
          mode: pending.options.mode,
          ...requestContext,
        }),
      }
    )
      .then(async () => {
        if (getChatError()) {
          failed();
          return;
        }
        await removePendingInitialMessage(
          window.sessionStorage,
          pending.missionId
        );
        if (pendingRef.current?.missionId === pending.missionId)
          pendingRef.current = null;
        setPending((current) =>
          current?.missionId === pending.missionId ? null : current
        );
      })
      .catch(failed)
      .finally(() => sendingRef.current.delete(pending.missionId));
  }, [
    pending,
    selectedMissionId,
    status,
    sendMessage,
    getChatError,
    clearChatError,
    messages,
    requestContext,
  ]);

  const retry = useCallback(async () => {
    const stored =
      (await loadPendingInitialMessage(
        window.sessionStorage,
        selectedMissionId
      )) ?? pendingRef.current;
    if (
      stored?.missionId !== selectedMissionId ||
      sendingRef.current.has(selectedMissionId)
    )
      return;
    clearChatError();
    await queue(stored).catch(() => undefined);
  }, [selectedMissionId, clearChatError, queue]);
  return {
    queue,
    retry,
    error:
      pending?.missionId === selectedMissionId && pending.failed
        ? FIRST_MESSAGE_FAILURE
        : null,
  };
}
