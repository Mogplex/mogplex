"use client";

import { useCallback, useState } from "react";
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

  const startNewSession = useCallback((target?: NewSessionTarget) => {
    setNewSessionTarget(target ?? null);
    setNewSessionRequest((current) => current + 1);
    setNewMission(true);
  }, []);

  const closeNewSession = useCallback(() => {
    setNewMission(false);
    setNewSessionTarget(null);
  }, []);

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
