"use client";

import { useEffect, useMemo } from "react";
import { TerminalSession } from "@/components/terminal-session";
import { useTerminalSessionsStore } from "@/hooks/use-terminal-sessions";
import { collectPanes, type TreeNode } from "@/hooks/use-split-panes";

// Mounts a TerminalSession for every terminal pane id currently in the tree.
// Sessions live at the top of the app so their React subtree (and the wterm
// WASM instance inside it) survives any pane tree reshape. Each session
// renders its DOM via createPortal into the anchor div managed by XTermPane.
export function TerminalHost({ root }: { root: TreeNode }) {
  const paneIds = useMemo(() => {
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
