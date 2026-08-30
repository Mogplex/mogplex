"use client";

import { useEffect, useState } from "react";
import type { UIMessage } from "ai";
import { useConversationsStore } from "@/hooks/use-conversations";

export function useAgentConversationLoader(input: {
  paneId: string;
  conversationId: string;
  repoId: string | null;
  workspaceSessionId: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const loadConversation = useConversationsStore(
    (state) => state.loadConversation
  );
  const startConversation = useConversationsStore(
    (state) => state.startConversation
  );
  const setUserId = useConversationsStore((state) => state.setUserId);
  const setDefaultModel = useConversationsStore(
    (state) => state.setDefaultModel
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const initialize = async () => {
      setLoaded(false);
      setInitialMessages([]);
      try {
        const [authResponse, settingsResponse] = await Promise.all([
          fetch("/api/auth/user"),
          fetch("/api/settings"),
        ]);
        if (settingsResponse.ok) {
          const settings = await settingsResponse.json();
          if (settings.default_model) setDefaultModel(settings.default_model);
        }
        if (authResponse.ok) {
          const { user } = await authResponse.json();
          if (user?.id && !cancelled) {
            setUserId(user.id);
            const stored = await loadConversation(
              input.paneId,
              input.conversationId,
              input.repoId,
              controller.signal
            );
            if (!stored && !cancelled) {
              startConversation(input.paneId, {
                id: input.conversationId,
                repoId: input.repoId,
                workspaceSessionId: input.workspaceSessionId,
              });
            }
          }
        }
      } catch (error) {
        console.warn("Failed to load pane context", {
          paneId: input.paneId,
          error,
        });
      }

      if (cancelled) return;
      setInitialMessages(
        useConversationsStore.getState().getConversation(input.paneId).messages
      );
      setLoaded(true);
    };

    void initialize();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    input.conversationId,
    input.paneId,
    input.repoId,
    input.workspaceSessionId,
    loadConversation,
    setDefaultModel,
    setUserId,
    startConversation,
  ]);

  return { initialMessages, loaded };
}
