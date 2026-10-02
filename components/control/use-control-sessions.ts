"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { UIMessage } from "ai";
import { mergeControlSessionLists } from "@/lib/control/session-list-merge";
import {
  persistBackedControlSessionMessages,
  type ControlSessionRecord,
} from "@/lib/control/session-persistence";
import type { ControlSessionSummary } from "@/lib/control/session-types";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import { loadControlSessionList } from "./session-list-data";
import { controlSelectionFailure } from "@/lib/control/session-list-state";
import { ClientFetchError, fetchJsonObject } from "@/lib/client-fetch";

const LAST_CONTROL_SESSION_KEY = "mogplex.control.lastSessionId";
const SESSION_EVENTS = [
  { table: "control_sessions", filter: "user_id=eq.$USER_ID" },
];

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
  chatPending = false,
}: {
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  setSessionMessages: (sessionId: string, messages: UIMessage[]) => boolean;
  removeSessionMessages: (sessionId: string) => void;
  /** Session id from the URL (?mission=) to restore once the list loads. */
  deepLinkTarget?: string | null;
  chatPending?: boolean;
}) {
  const [sessions, setSessions] = useState<ControlSessionSummary[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const failedSelectionRef = useRef<string | null>(null);
  const missingSelectionRef = useRef(false);
  const restoreInFlightRef = useRef(false);
  const listRequestRef = useRef(0);
  const updatedAtBySessionRef = useRef(new Map<string, string>());
  const mutationRevisionRef = useRef(0);
  const removedSessionIdsRef = useRef(new Set<string>());
  const selectionRevisionRef = useRef(0);
  const selectedIdRef = useRef(sessionId);
  useLayoutEffect(() => {
    selectedIdRef.current = sessionId;
  }, [sessionId]);
  const restoredSelectionRef = useRef(false);
  const refreshRevisionRef = useRef(0);

  const refreshCurrent = useCallback(async () => {
    if (!sessionId || chatPending) return;
    const requestRevision = ++refreshRevisionRef.current;
    const mutationRevision = mutationRevisionRef.current;
    let record: ControlSessionRecord;
    try {
      record = await fetchJsonObject<ControlSessionRecord>(
        `/api/control/sessions?id=${encodeURIComponent(sessionId)}`,
        "Could not load this chat. Try again."
      );
    } catch (error) {
      if (requestRevision === refreshRevisionRef.current) {
        failedSelectionRef.current = sessionId;
        const { missing, message } = controlSelectionFailure(error);
        missingSelectionRef.current = missing;
        setSelectionError(message);
      }
      return;
    }
    if (
      requestRevision !== refreshRevisionRef.current ||
      mutationRevision !== mutationRevisionRef.current ||
      record.id !== sessionId
    )
      return;
    // hydrate refuses active streams, unsaved local edits and failed saves.
    if (setSessionMessages(record.id, record.messages ?? [])) {
      updatedAtBySessionRef.current.set(record.id, record.updated_at);
      setSessions((current) =>
        current.map((entry) =>
          entry.id === record.id
            ? { ...entry, updated_at: record.updated_at }
            : entry
        )
      );
    }
  }, [sessionId, chatPending, setSessionMessages]);
  useRealtimeRouteRefresh({
    channelName: "control-conversation",
    specs: SESSION_EVENTS,
    enabled: Boolean(sessionId),
    onInvalidate: refreshCurrent,
  });
  useEffect(() => {
    void refreshCurrent();
    return () => {
      refreshRevisionRef.current++;
    };
  }, [refreshCurrent]);

  const refreshList = useCallback(async () => {
    const revision = mutationRevisionRef.current;
    const request = ++listRequestRef.current;
    setSessionsError(null);
    let fetched: ControlSessionSummary[];
    try {
      fetched = await loadControlSessionList();
    } catch (error) {
      if (request === listRequestRef.current)
        setSessionsError(
          error instanceof ClientFetchError
            ? error.message
            : "Could not load chats. Try again."
        );
      return;
    }
    if (request !== listRequestRef.current) return;
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
    if (
      missingSelectionRef.current &&
      !fetched.some((entry) => entry.id === failedSelectionRef.current)
    ) {
      if (selectedIdRef.current === failedSelectionRef.current)
        setSessionId(null);
      failedSelectionRef.current = null;
      missingSelectionRef.current = false;
      setSelectionError(null);
    }
  }, [setSessionId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);
  useRealtimeRouteRefresh({
    channelName: "control-session-list",
    specs: SESSION_EVENTS,
    onInvalidate: refreshList,
  });

  const selectSession = useCallback(
    async (id: string) => {
      const revision = ++selectionRevisionRef.current;
      let record: ControlSessionRecord;
      try {
        record = await fetchJsonObject<ControlSessionRecord>(
          `/api/control/sessions?id=${encodeURIComponent(id)}`,
          "Could not load this chat. Try again."
        );
        if (record.id !== id || !Array.isArray(record.messages))
          throw new Error("Invalid session");
      } catch (error) {
        if (revision === selectionRevisionRef.current) {
          failedSelectionRef.current = id;
          const { missing, message } = controlSelectionFailure(error);
          missingSelectionRef.current = missing;
          setSelectionError(message);
        }
        return false;
      }
      if (
        revision !== selectionRevisionRef.current ||
        removedSessionIdsRef.current.has(id)
      )
        return false;
      const hydrated = setSessionMessages(record.id, record.messages ?? []);
      if (hydrated) {
        updatedAtBySessionRef.current.set(record.id, record.updated_at);
      }
      selectedIdRef.current = record.id;
      restoredSelectionRef.current = true;
      missingSelectionRef.current = false;
      setSessionId(record.id);
      window.localStorage.setItem(LAST_CONTROL_SESSION_KEY, record.id);
      failedSelectionRef.current = null;
      setSelectionError(null);
      return true;
    },
    [setSessionId, setSessionMessages]
  );

  // Restore the URL target, then the last opened chat, then the most recent
  // chat. Global navigation returns to bare /control, so relying on the query
  // string alone would strand persisted follow-up turns behind an empty view.
  useEffect(() => {
    if (
      restoredSelectionRef.current ||
      restoreInFlightRef.current ||
      !sessionsLoaded
    )
      return;
    const remembered = window.localStorage.getItem(LAST_CONTROL_SESSION_KEY);
    const target =
      (deepLinkTarget && sessions.some((entry) => entry.id === deepLinkTarget)
        ? deepLinkTarget
        : null) ??
      (remembered && sessions.some((entry) => entry.id === remembered)
        ? remembered
        : null) ??
      sessions[0]?.id ??
      null;
    if (!target || target === sessionId) {
      restoredSelectionRef.current = true;
      return;
    }
    restoreInFlightRef.current = true;
    void selectSession(target)
      .then((selected) => {
        if (selected) restoredSelectionRef.current = true;
      })
      .finally(() => {
        restoreInFlightRef.current = false;
      });
  }, [sessions, sessionsLoaded, deepLinkTarget, selectSession, sessionId]);

  const createSession = useCallback(
    async (
      title: string,
      project?: string,
      repoId?: string | null,
      request?: string,
      modelId?: string | null
    ) => {
      const res = await fetch("/api/control/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.slice(0, 80) || "New session",
          project: project?.trim() || null,
          repo_id: repoId || null,
          model_id: modelId ?? null,
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
          model_id: record.model_id,
          orchestration_run_id: record.orchestration_run_id,
          pinned: record.pinned,
          updated_at: record.updated_at,
        },
        ...current,
      ]);
      selectionRevisionRef.current++;
      restoredSelectionRef.current = true;
      failedSelectionRef.current = null;
      missingSelectionRef.current = false;
      setSelectionError(null);
      setSessionId(record.id);
      window.localStorage.setItem(LAST_CONTROL_SESSION_KEY, record.id);
      return record.id;
    },
    [setSessionId, setSessionMessages]
  );

  const persistSession = useCallback(
    async (targetSessionId: string, messages: UIMessage[]) => {
      const expected = updatedAtBySessionRef.current.get(targetSessionId);
      const session = await persistBackedControlSessionMessages({
        sessionId: targetSessionId,
        messages,
        expectedUpdatedAt: expected,
      });
      if (!session) return;
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
      model_id?: string | null;
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
        if (
          window.localStorage.getItem(LAST_CONTROL_SESSION_KEY) === sessionId
        ) {
          window.localStorage.removeItem(LAST_CONTROL_SESSION_KEY);
        }
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
                model_id: session.model_id,
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

  const deleteSession = useCallback(
    async (targetSessionId: string): Promise<boolean> => {
      let res: Response;
      try {
        res = await fetch(
          `/api/control/sessions?id=${encodeURIComponent(targetSessionId)}`,
          { method: "DELETE" }
        );
      } catch {
        return false;
      }
      if (!res.ok) return false;

      mutationRevisionRef.current += 1;
      selectionRevisionRef.current += 1;
      removedSessionIdsRef.current.add(targetSessionId);
      updatedAtBySessionRef.current.delete(targetSessionId);
      setSessions((current) =>
        current.filter((entry) => entry.id !== targetSessionId)
      );
      removeSessionMessages(targetSessionId);
      if (targetSessionId === sessionId) setSessionId(null);
      if (
        window.localStorage.getItem(LAST_CONTROL_SESSION_KEY) ===
        targetSessionId
      ) {
        window.localStorage.removeItem(LAST_CONTROL_SESSION_KEY);
      }
      return true;
    },
    [removeSessionMessages, sessionId, setSessionId]
  );

  const setSessionArchived = useCallback(
    async (
      target: ControlSessionSummary,
      archived: boolean
    ): Promise<ControlSessionSummary | null> => {
      const response = await fetch("/api/control/sessions?summary=true", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: target.id,
          archived,
          expected_updated_at: target.updated_at,
        }),
      });
      if (!response.ok) {
        if (response.status === 409) await refreshList();
        return null;
      }
      const { session } = (await response.json()) as {
        session: ControlSessionSummary;
      };
      mutationRevisionRef.current++;
      updatedAtBySessionRef.current.set(target.id, session.updated_at);
      if (archived) {
        removedSessionIdsRef.current.add(target.id);
        setSessions((current) =>
          current.filter((entry) => entry.id !== target.id)
        );
        removeSessionMessages(target.id);
        if (selectedIdRef.current === target.id) setSessionId(null);
        if (
          window.localStorage.getItem(LAST_CONTROL_SESSION_KEY) === target.id
        ) {
          window.localStorage.removeItem(LAST_CONTROL_SESSION_KEY);
        }
      } else {
        removedSessionIdsRef.current.delete(target.id);
        setSessions((current) => [
          session,
          ...current.filter((entry) => entry.id !== target.id),
        ]);
      }
      return session;
    },
    [refreshList, removeSessionMessages, setSessionId]
  );

  return {
    setSessionArchived,
    sessions,
    sessionsLoaded,
    sessionsError,
    selectionError,
    retryList: refreshList,
    retrySelection: () =>
      sessionId && failedSelectionRef.current && !missingSelectionRef.current
        ? selectSession(failedSelectionRef.current)
        : refreshList(),
    selectSession,
    createSession,
    updateSession,
    deleteSession,
    persistSession,
    refreshList,
  };
}
