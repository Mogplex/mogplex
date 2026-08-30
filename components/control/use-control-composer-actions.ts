"use client";

import { useCallback } from "react";
import { MISSION_PERMISSION_OPTIONS } from "@/lib/control/types";
import type { ComposerSendOptions } from "./composer";

type SendInstruction = (
  text: string,
  target: string,
  scope: string,
  options: ComposerSendOptions
) => Promise<boolean>;

export function useControlComposerActions({
  updateSession,
  setChatError,
  send,
  openChat,
}: {
  updateSession: (fields: { model_id: string }) => Promise<boolean>;
  setChatError: (message: string | null) => void;
  send: SendInstruction;
  openChat: () => void;
}) {
  const selectModel = useCallback(
    async (modelId: string) => {
      try {
        const saved = await updateSession({ model_id: modelId });
        if (!saved) {
          setChatError("Could not save the conversation model. Try again.");
        }
        return saved;
      } catch {
        setChatError("Could not save the conversation model. Try again.");
        return false;
      }
    },
    [setChatError, updateSession]
  );

  const sendInstruction = useCallback(
    (text: string) => {
      openChat();
      void send(text, "mission", "IMPLEMENT", {
        model: null,
        permissions: MISSION_PERMISSION_OPTIONS[0],
        mode: "run",
        files: [],
      });
    },
    [openChat, send]
  );

  return { selectModel, sendInstruction };
}
