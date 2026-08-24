"use client";

import { useCallback, useState } from "react";
import type { ControlSessionSummary } from "@/lib/control/session-types";
import type { NewSessionTarget } from "./session-list-actions";

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

  const startNewSession = useCallback((target?: NewSessionTarget) => {
    setNewSessionTarget(target ?? null);
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
        setNewMission(true);
      }
      return deleted;
    },
    [deleteSession, sessions, sessionId]
  );

  return {
    newMission,
    newSessionTarget,
    startNewSession,
    closeNewSession,
    deleteChat,
  };
}
