"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { mergeControlSessionLists } from "@/lib/control/session-list-merge";
import {
  persistControlSessionMessages,
  type ControlSessionRecord,
} from "@/lib/control/session-persistence";
import type { ControlSessionSummary } from "./session-list";

/**
 * DB-backed control chat sessions: list, create, restore, and persist.
 * Messages sync whole-array with optimistic concurrency on updated_at
 * (same pattern as the pane workspace's conversations store).
 *
 * updated_at revisions are tracked per session so background chat completions
 * persist to their own rows even after the user selects another session.
 */
export function useControlSessions({
  sessionId,
  setSessionId,
  setSessionMessages,
  removeSessionMessages,
  deepLinkTarget,
}: {
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  setSessionMessages: (sessionId: string, messages: UIMessage[]) => boolean;
  removeSessionMessages: (sessionId: string) => void;
  /** Session id from the URL (?mission=) to restore once the list loads. */
  deepLinkTarget?: string | null;
}) {
  const [sessions, setSessions] = useState<ControlSessionSummary[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const updatedAtBySessionRef = useRef(new Map<string, string>());
  const mutationRevisionRef = useRef(0);
  const removedSessionIdsRef = useRef(new Set<string>());
  const selectionRevisionRef = useRef(0);

  const refreshList = useCallback(async () => {
    const revision = mutationRevisionRef.current;
    const res = await fetch("/api/control/sessions");
    if (!res.ok) return;
    const fetched = (await res.json()) as ControlSessionSummary[];
    setSessionsLoaded(true);
    for (const session of fetched) {
      if (!updatedAtBySessionRef.current.has(session.id)) {
        updatedAtBySessionRef.current.set(session.id, session.updated_at);
      }
    }
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
      const revision = ++selectionRevisionRef.current;
      const res = await fetch(`/api/control/sessions?id=${id}`);
      if (!res.ok) return;
      const record = (await res.json()) as ControlSessionRecord;
      const hydrated = setSessionMessages(record.id, record.messages ?? []);
      if (hydrated) {
        updatedAtBySessionRef.current.set(record.id, record.updated_at);
      }
      if (revision !== selectionRevisionRef.current) return;
      setSessionId(record.id);
    },
    [setSessionId, setSessionMessages]
  );

  // Deep link: ?mission=<session id> restores that session's history.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current || sessions.length === 0) return;
    if (!deepLinkTarget || !sessions.some((s) => s.id === deepLinkTarget)) {
      return;
    }
    deepLinkedRef.current = true;
    if (deepLinkTarget === sessionId) return;

    void selectSession(deepLinkTarget);
  }, [sessions, deepLinkTarget, selectSession, sessionId]);

  const createSession = useCallback(
    async (
      title: string,
      project?: string,
      repoId?: string | null,
      request?: string
    ) => {
      const res = await fetch("/api/control/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.slice(0, 80) || "New session",
          project: project?.trim() || null,
          repo_id: repoId || null,
          request: request?.trim() || title,
        }),
      });
      if (!res.ok) return null;
      const record = (await res.json()) as ControlSessionRecord;
      mutationRevisionRef.current += 1;
      removedSessionIdsRef.current.delete(record.id);
      updatedAtBySessionRef.current.set(record.id, record.updated_at);
      setSessionMessages(record.id, record.messages ?? []);
      setSessions((current) => [
        {
          id: record.id,
          title: record.title,
          project: record.project,
          repo_id: record.repo_id,
          orchestration_run_id: record.orchestration_run_id,
          pinned: record.pinned,
          updated_at: record.updated_at,
        },
        ...current,
      ]);
      setSessionId(record.id);
      return record.id;
    },
    [setSessionId, setSessionMessages]
  );

  const persistSession = useCallback(
    async (targetSessionId: string, messages: UIMessage[]) => {
      const expected = updatedAtBySessionRef.current.get(targetSessionId);
      if (messages.length === 0) return;
      // Seeded mission chats do not have a database row and intentionally
      // remain local-only until a control session is created.
      if (!expected) return;

      const session = await persistControlSessionMessages({
        sessionId: targetSessionId,
        messages,
        expectedUpdatedAt: expected,
      });
      mutationRevisionRef.current += 1;
      updatedAtBySessionRef.current.set(targetSessionId, session.updated_at);
      setSessions((current) =>
        current.map((entry) =>
          entry.id === targetSessionId
            ? { ...entry, updated_at: session.updated_at }
            : entry
        )
      );
    },
    []
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
      const expected = sessionId
        ? updatedAtBySessionRef.current.get(sessionId)
        : null;
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
        const record = (await fresh.json()) as ControlSessionRecord;
        res = await put(record.updated_at);
      }
      if (!res.ok) return false;

      const { session } = (await res.json()) as {
        session: ControlSessionRecord;
      };
      mutationRevisionRef.current += 1;
      updatedAtBySessionRef.current.set(sessionId, session.updated_at);
      if (fields.archived) {
        removedSessionIdsRef.current.add(sessionId);
        updatedAtBySessionRef.current.delete(sessionId);
        setSessions((current) =>
          current.filter((entry) => entry.id !== sessionId)
        );
        removeSessionMessages(sessionId);
        setSessionId(null);
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
    [removeSessionMessages, sessionId, setSessionId]
  );

  return {
    sessions,
    sessionsLoaded,
    selectSession,
    createSession,
    updateSession,
    persistSession,
    refreshList,
  };
}
