"use client";

import { useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useSessionsStore } from "@/hooks/use-sessions";
import { useTerminalSessionsStore } from "@/hooks/use-terminal-sessions";
import { collectPanes } from "@/hooks/use-split-panes";

const TerminalSession = dynamic(
  () =>
    import("@/components/terminal-session").then((module) =>
      module.TerminalSession
    ),
  { ssr: false }
);

// Mounted by the scoped layout so the active TerminalSession survives both
// pane-tree reshapes and navigation away from the workspace route. Each
// session renders its DOM via createPortal into the anchor managed by
// XTermPane, or into an offscreen fallback while the workspace is hidden.
export function TerminalHost() {
  const root = useSessionsStore((state) => {
    const activeSession =
      state.sessions.find(
        (session) => session.id === state.activeSessionId
      ) ?? state.sessions[0];
    return activeSession?.paneTree;
  });
  const paneIds = useMemo(() => {
    if (!root) return [];
    const ids = collectPanes(root)
      .filter((pane) => pane.type === "terminal")
      .map((pane) => pane.id);
    return Array.from(new Set(ids));
  }, [root]);

  const clearSession = useTerminalSessionsStore((state) => state.clearSession);

  useEffect(() => {
    const active = new Set(paneIds);
    const known = new Set<string>([
      ...Object.keys(useTerminalSessionsStore.getState().anchors),
      ...Object.keys(useTerminalSessionsStore.getState().bindings),
    ]);
    for (const id of known) {
      if (!active.has(id)) clearSession(id);
    }
  }, [clearSession, paneIds]);

  return (
    <>
      {paneIds.map((id) => (
        <TerminalSession key={id} paneId={id} />
      ))}
    </>
  );
}
