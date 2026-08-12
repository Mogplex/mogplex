"use client";

import { useCallback } from "react";
import type { ComposerSendOptions } from "./composer";
import {
  buildControlChatBody,
  buildControlChatMessage,
  type ControlChatRequestContext,
} from "./control-chat-request";

type SendMessage = (
  message: ReturnType<typeof buildControlChatMessage>,
  options: { body: ReturnType<typeof buildControlChatBody> }
) => Promise<void>;

/**
 * Conversation-composer send path: streams the message through the control
 * chat endpoint; the user message renders from the chat's own message list
 * (buildCombinedTimeline), not from an ephemeral timeline echo.
 */
export function useControlSend({
  sendMessage,
  setChatError,
  clearComposer,
  requestContext,
}: {
  sendMessage: SendMessage;
  setChatError: (message: string | null) => void;
  clearComposer: () => void;
  requestContext: ControlChatRequestContext;
}) {
  return useCallback(
    async (
      text: string,
      target: string,
      scopeLevel: string,
      options: ComposerSendOptions
    ) => {
      if (!text.trim() && options.files.length === 0) return;

      setChatError(null);
      try {
        await sendMessage(buildControlChatMessage(text, options), {
          body: buildControlChatBody({
            model: options.model,
            scope: scopeLevel,
            target,
            permissions: options.permissions,
            mode: options.mode,
            ...requestContext,
          }),
        });
        clearComposer();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Chat error";
        if (message.includes("404") || message.includes("Not Found")) {
          setChatError("Control chat endpoint not yet deployed.");
        } else {
          setChatError(message);
        }
      }
    },
    [sendMessage, setChatError, clearComposer, requestContext]
  );
}
