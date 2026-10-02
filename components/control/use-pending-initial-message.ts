"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPendingInitialMessageDeadline,
  FIRST_MESSAGE_FAILURE,
  loadPendingInitialMessage,
  removePendingInitialMessage,
  savePendingInitialMessage,
  pendingInitialMessageRetryId,
  type PendingUserTurn,
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
  messages: PendingUserTurn[];
  requestContext: ControlChatRequestContext;
}) {
  const [pending, setPending] = useState<PendingInitialMessage | null>(null);
  const pendingRef = useRef<PendingInitialMessage | null>(null);
  const sendingRef = useRef(new Set<string>());
  const queue = useCallback(async (next: PendingInitialMessage) => {
    const queued = {
      ...next,
      failed: false,
      recovered: false,
      queuedAt: Date.now(),
    };
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
      .then((stored) => {
        if (!current || !stored) return undefined;
        // A reload cannot establish whether the server accepted the previous
        // request. Keep it recoverable and let Retry explicitly resend it.
        pendingRef.current = stored;
        setPending({
          ...stored,
          failed: true,
          recovered: Boolean(stored.recovered || !stored.failed),
        });
        return undefined;
      })
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
      if (sendingRef.current.has(pending.missionId)) return;
      const deadline = createPendingInitialMessageDeadline(
        failed,
        pending.queuedAt
      );
      return deadline.cancel;
    }
    if (sendingRef.current.has(pending.missionId)) return;
    sendingRef.current.add(pending.missionId);
    clearChatError();
    // Retain completed or different follow-ups when the saved draft is retried.
    const previousId = pendingInitialMessageRetryId(messages, pending);
    void sendMessage(
      {
        ...buildControlChatMessage(pending.text, pending.options),
        ...(previousId ? { messageId: previousId } : {}),
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
        try {
          await removePendingInitialMessage(
            window.sessionStorage,
            pending.missionId
          );
        } catch {
          console.warn("Could not clear a delivered first-message draft");
        }
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
    await queue({ ...stored, attachmentsMissing: false }).catch(
      () => undefined
    );
  }, [selectedMissionId, clearChatError, queue]);
  return {
    queue,
    retry,
    error:
      pending?.missionId === selectedMissionId && pending.failed
        ? pending.attachmentsMissing
          ? `${pending.recovered ? "We saved your first message" : FIRST_MESSAGE_FAILURE}. We could not load some files. Retry sends your saved text and available files.`
          : pending.recovered
            ? "We saved your first message. Retry sends it again."
            : FIRST_MESSAGE_FAILURE
        : null,
  };
}
