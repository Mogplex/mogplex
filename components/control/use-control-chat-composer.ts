"use client";

import { useCallback, useState } from "react";

/** Keeps unsent composer text attached to the chat where it was entered. */
export function useControlChatComposer(sessionId: string) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const setDraft = useCallback(
    (value: string) => {
      setDrafts((current) => {
        if (current[sessionId] === value) return current;
        if (!value) {
          const next = { ...current };
          delete next[sessionId];
          return next;
        }
        return { ...current, [sessionId]: value };
      });
    },
    [sessionId]
  );

  return [drafts[sessionId] ?? "", setDraft] as const;
}
