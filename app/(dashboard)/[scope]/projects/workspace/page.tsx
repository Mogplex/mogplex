"use client";
import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { RunWorkspace } from "./_components/run-workspace";
import {
  getPreferredWorkspaceSession,
  useSessionsHydrated,
  useSessionsStore,
} from "@/hooks/use-sessions";
import { AsciiLoader } from "@/components/ascii-loader";
import { WorkspaceShell } from "./_components/workspace-shell";

export default function WorkspacePage() {
  return <Suspense fallback={<AsciiLoader />}><WorkspaceRoute /></Suspense>;
}

function WorkspaceRoute() {
  const runId = useSearchParams().get("run");
  return runId ? <RunWorkspace key={runId} runId={runId} /> : <DefaultWorkspace />;
}

function DefaultWorkspace() {
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
