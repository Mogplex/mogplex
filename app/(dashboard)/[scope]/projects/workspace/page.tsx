"use client";
import { useEffect, useMemo } from "react";
import {
  getPreferredWorkspaceSession,
  useSessionsHydrated,
  useSessionsStore,
} from "@/hooks/use-sessions";
import { AsciiLoader } from "@/components/ascii-loader";
import { WorkspaceShell } from "./_components/workspace-shell";

export default function WorkspacePage() {
  const sessions = useSessionsStore((state) => state.sessions);
  const activeSessionId = useSessionsStore((state) => state.activeSessionId);
  const switchSession = useSessionsStore((state) => state.switchSession);
  const sessionsHydrated = useSessionsHydrated();
  const preferredWorkspaceSession = useMemo(
    () => getPreferredWorkspaceSession(sessions, activeSessionId),
    [activeSessionId, sessions]
  );

  useEffect(() => {
    if (!sessionsHydrated) return;

    if (
      preferredWorkspaceSession &&
      preferredWorkspaceSession.id !== activeSessionId
    ) {
      switchSession(preferredWorkspaceSession.id);
    }
  }, [
    activeSessionId,
    preferredWorkspaceSession,
    sessionsHydrated,
    switchSession,
  ]);

  if (
    !sessionsHydrated ||
    (preferredWorkspaceSession &&
      preferredWorkspaceSession.id !== activeSessionId)
  ) {
    return (
      <div className="bg-background flex h-full items-center justify-center">
        <AsciiLoader />
      </div>
    );
  }

  return <WorkspaceShell />;
}
