"use client";

import { useCallback, useState } from "react";

export function useControlChatError(activeChatId: string) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setError = useCallback(
    (message: string | null) => {
      setErrors((current) => {
        if (message !== null) {
          if (current[activeChatId] === message) return current;
          return { ...current, [activeChatId]: message };
        }
        if (!(activeChatId in current)) return current;
        const next = { ...current };
        delete next[activeChatId];
        return next;
      });
    },
    [activeChatId]
  );
  const removeError = useCallback((sessionId: string) => {
    setErrors((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }, []);

  return { error: errors[activeChatId] ?? null, setError, removeError };
}
