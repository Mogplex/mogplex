"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import type { ControlSessionSummary } from "./session-list";

type SessionRecord = ControlSessionSummary & {
  messages: UIMessage[];
};

/**
 * DB-backed control chat sessions: list, create, restore, and persist.
 * Messages sync whole-array with optimistic concurrency on updated_at
 * (same pattern as the pane workspace's conversations store).
 *
 * sessionId state lives in the caller so the useChat instance can key
 * itself by the active session.
 */
export function useControlSessions({
  sessionId,
  setSessionId,
  chatStatus,
  setMessages,
  deepLinkTarget,
}: {
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  chatStatus: string;
  setMessages: (messages: UIMessage[]) => void;
  /** Session id from the URL (?mission=) to restore once the list loads. */
  deepLinkTarget?: string | null;
}) {
  const [sessions, setSessions] = useState<ControlSessionSummary[]>([]);
  const updatedAtRef = useRef<string | null>(null);
  const pendingRestoreRef = useRef<UIMessage[] | null>(null);
  const [restoreTick, setRestoreTick] = useState(0);

  const refreshList = useCallback(async () => {
    const res = await fetch("/api/control/sessions");
    if (!res.ok) return;
    setSessions((await res.json()) as ControlSessionSummary[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch populates the session list
    void refreshList();
  }, [refreshList]);

  const selectSession = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/control/sessions?id=${id}`);
      if (!res.ok) return;
      const record = (await res.json()) as SessionRecord;
      updatedAtRef.current = record.updated_at;
      pendingRestoreRef.current = record.messages ?? [];
      setSessionId(record.id);
      setRestoreTick((tick) => tick + 1);
    },
    [setSessionId]
  );

  // Restore messages once the re-keyed chat instance is live.
  useEffect(() => {
    if (!pendingRestoreRef.current || chatStatus !== "ready") return;
    const restore = pendingRestoreRef.current;
    pendingRestoreRef.current = null;
    setMessages(restore);
  }, [chatStatus, restoreTick, setMessages]);

  // Deep link: ?mission=<session id> restores that session's history.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current || sessions.length === 0) return;
    if (!deepLinkTarget || !sessions.some((s) => s.id === deepLinkTarget)) {
      return;
    }
    deepLinkedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores a deep-linked session once the list loads
    void selectSession(deepLinkTarget);
  }, [sessions, deepLinkTarget, selectSession]);

  const createSession = useCallback(
    async (title: string) => {
      const res = await fetch("/api/control/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.slice(0, 80) || "New session" }),
      });
      if (!res.ok) return null;
      const record = (await res.json()) as SessionRecord;
      updatedAtRef.current = record.updated_at;
      setSessions((current) => [
        {
          id: record.id,
          title: record.title,
          pinned: record.pinned,
          updated_at: record.updated_at,
        },
        ...current,
      ]);
      setSessionId(record.id);
      return record.id;
    },
    [setSessionId]
  );

  const persist = useCallback(
    async (messages: UIMessage[]) => {
      const expected = updatedAtRef.current;
      if (!sessionId || !expected || messages.length === 0) return;

      const put = (expectedUpdatedAt: string) =>
        fetch("/api/control/sessions", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: sessionId,
            messages,
            expected_updated_at: expectedUpdatedAt,
          }),
        });

      let res = await put(expected);
      if (res.status === 409) {
        // Another tab/device won the race: rebase on its timestamp and
        // retry once with our newer message array.
        const fresh = await fetch(`/api/control/sessions?id=${sessionId}`);
        if (!fresh.ok) return;
        const record = (await fresh.json()) as SessionRecord;
        res = await put(record.updated_at);
      }
      if (!res.ok) return;

      const { session } = (await res.json()) as { session: SessionRecord };
      updatedAtRef.current = session.updated_at;
      setSessions((current) =>
        current.map((entry) =>
          entry.id === sessionId
            ? { ...entry, updated_at: session.updated_at }
            : entry
        )
      );
    },
    [sessionId]
  );

  return { sessions, selectSession, createSession, persist, refreshList };
}
