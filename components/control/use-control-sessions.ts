"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { mergeControlSessionLists } from "@/lib/control/session-list-merge";
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
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const updatedAtRef = useRef<string | null>(null);
  const pendingRestoreRef = useRef<UIMessage[] | null>(null);
  const mutationRevisionRef = useRef(0);
  const removedSessionIdsRef = useRef(new Set<string>());
  const [restoreTick, setRestoreTick] = useState(0);

  const refreshList = useCallback(async () => {
    const revision = mutationRevisionRef.current;
    const res = await fetch("/api/control/sessions");
    if (!res.ok) return;
    const fetched = (await res.json()) as ControlSessionSummary[];
    setSessionsLoaded(true);
    // An initial list request can finish after a new session was created.
    // Merge it without overwriting local mutations or reviving archives.
    if (revision !== mutationRevisionRef.current) {
      setSessions((current) =>
        mergeControlSessionLists(current, fetched, removedSessionIdsRef.current)
      );
      return;
    }
    setSessions(fetched);
  }, []);

  useEffect(() => {
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
    if (deepLinkTarget === sessionId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores a deep-linked session once the list loads
    void selectSession(deepLinkTarget);
  }, [sessions, deepLinkTarget, selectSession, sessionId]);

  const createSession = useCallback(
    async (title: string, project?: string, repoId?: string | null) => {
      const res = await fetch("/api/control/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.slice(0, 80) || "New session",
          project: project?.trim() || null,
          repo_id: repoId || null,
        }),
      });
      if (!res.ok) return null;
      const record = (await res.json()) as SessionRecord;
      mutationRevisionRef.current += 1;
      removedSessionIdsRef.current.delete(record.id);
      updatedAtRef.current = record.updated_at;
      setSessions((current) => [
        {
          id: record.id,
          title: record.title,
          project: record.project,
          repo_id: record.repo_id,
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
      mutationRevisionRef.current += 1;
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

  /**
   * Rename/pin/archive the selected session with the same optimistic
   * concurrency as persist (one rebase retry on 409). Archiving removes the
   * session from the list and clears the selection.
   */
  const updateSession = useCallback(
    async (fields: {
      title?: string;
      pinned?: boolean;
      archived?: boolean;
    }): Promise<boolean> => {
      const expected = updatedAtRef.current;
      if (!sessionId || !expected) return false;

      const put = (expectedUpdatedAt: string) =>
        fetch("/api/control/sessions", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: sessionId,
            ...fields,
            expected_updated_at: expectedUpdatedAt,
          }),
        });

      let res = await put(expected);
      if (res.status === 409) {
        const fresh = await fetch(`/api/control/sessions?id=${sessionId}`);
        if (!fresh.ok) return false;
        const record = (await fresh.json()) as SessionRecord;
        res = await put(record.updated_at);
      }
      if (!res.ok) return false;

      const { session } = (await res.json()) as { session: SessionRecord };
      mutationRevisionRef.current += 1;
      updatedAtRef.current = session.updated_at;
      if (fields.archived) {
        removedSessionIdsRef.current.add(sessionId);
        setSessions((current) =>
          current.filter((entry) => entry.id !== sessionId)
        );
        setSessionId(null);
        setMessages([]);
        return true;
      }
      if (fields.archived === false) {
        removedSessionIdsRef.current.delete(sessionId);
      }
      setSessions((current) =>
        current.map((entry) =>
          entry.id === sessionId
            ? {
                ...entry,
                title: session.title,
                pinned: session.pinned,
                updated_at: session.updated_at,
              }
            : entry
        )
      );
      return true;
    },
    [sessionId, setSessionId, setMessages]
  );

  return {
    sessions,
    sessionsLoaded,
    selectSession,
    createSession,
    updateSession,
    persist,
    refreshList,
  };
}
