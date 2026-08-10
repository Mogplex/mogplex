"use client";

import { useEffect, useRef } from "react";
import type { ComposerSendOptions } from "./composer";
import {
  buildControlChatBody,
  buildControlChatMessage,
} from "./control-chat-request";

type SendMessage = (
  message: ReturnType<typeof buildControlChatMessage>,
  options: { body: ReturnType<typeof buildControlChatBody> }
) => Promise<void>;

/**
 * A mission's first message can't go through sendMessage directly from the
 * create handler: useChat is keyed by mission/session id, so the send would
 * hit the instance of the mission we're navigating away from. Park it here
 * and send once the re-keyed chat is live.
 */
export function usePendingInitialMessage({
  selectedMissionId,
  status,
  sendMessage,
  onError,
}: {
  selectedMissionId: string;
  status: string;
  sendMessage: SendMessage;
  onError: (message: string) => void;
}) {
  const pendingRef = useRef<{
    missionId: string;
    text: string;
    options: ComposerSendOptions;
  } | null>(null);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (pending.missionId !== selectedMissionId) return;
    if (status !== "ready") return;
    const { text, options } = pending;
    pendingRef.current = null;
    sendMessage(buildControlChatMessage(text, options), {
      body: buildControlChatBody({
        model: options.model,
        scope: options.mode === "plan" ? "PLAN ONLY" : "IMPLEMENT",
        target: "mission",
        permissions: options.permissions,
        mode: options.mode,
      }),
    }).catch((err: unknown) => {
      onError(err instanceof Error ? err.message : "Chat error");
    });
  }, [selectedMissionId, status, sendMessage, onError]);

  return pendingRef;
}
