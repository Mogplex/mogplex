"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlSessionSummary } from "@/lib/control/session-types";
import type { NewSessionTarget } from "@/lib/control/session-project";

export function useControlSessionActions({
  sessionId,
  sessions,
  deleteSession,
}: {
  sessionId: string | null;
  sessions: ControlSessionSummary[];
  deleteSession: (id: string) => Promise<boolean>;
}) {
  const [newMission, setNewMission] = useState(false);
  const [newSessionTarget, setNewSessionTarget] =
    useState<NewSessionTarget | null>(null);
  // Bumped on every "New" click so the composer starts fresh even when two
  // clicks resolve to the same project.
  const [newSessionRequest, setNewSessionRequest] = useState(0);

  const openedForClearedSelection = useRef(false);
  const startNewSession = useCallback((target?: NewSessionTarget) => {
    openedForClearedSelection.current = false;
    setNewSessionTarget(target ?? null);
    setNewSessionRequest((current) => current + 1);
    setNewMission(true);
  }, []);

  const closeNewSession = useCallback(() => {
    openedForClearedSelection.current = false;
    setNewMission(false);
    setNewSessionTarget(null);
  }, []);

  // Archive and external deletion can clear selection outside deleteChat.
  const previousSessionId = useRef(sessionId);
  useEffect(() => {
    const previous = previousSessionId.current;
    previousSessionId.current = sessionId;
    if (previous && !sessionId && !newMission) {
      startNewSession();
      openedForClearedSelection.current = true;
    } else if (!previous && sessionId && openedForClearedSelection.current) {
      // A selection already in flight wins over the archive fallback; an
      // explicit New click clears this flag and keeps the fresh composer.
      closeNewSession();
    }
  }, [sessionId, newMission, startNewSession, closeNewSession]);

  const deleteChat = useCallback(
    async (id: string) => {
      const deletingActiveSession = id === sessionId;
      const deletedSession = sessions.find((entry) => entry.id === id);
      const deleted = await deleteSession(id);
      if (deleted && deletingActiveSession) {
        setNewSessionTarget(
          deletedSession
            ? {
                project: deletedSession.project,
                repoId: deletedSession.repo_id,
              }
            : null
        );
        setNewSessionRequest((current) => current + 1);
        setNewMission(true);
      }
      return deleted;
    },
    [deleteSession, sessions, sessionId]
  );

  return {
    newMission,
    newSessionTarget,
    newSessionRequest,
    startNewSession,
    closeNewSession,
    deleteChat,
  };
}
