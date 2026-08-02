"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useTerminalSessionsStore } from "@/hooks/use-terminal-sessions";

type Props = {
  paneId: string;
  sandboxId?: string;
  repoId?: string;
  workingBranch?: string | null;
  terminalSessionKey: string;
};

// The live wterm instance is rendered by <TerminalSession> (mounted once per
// paneId in <TerminalHost>) and portaled into the anchor ref set here. Keeping
// the terminal out of the pane subtree means any tree reshape — same-direction
// split, perpendicular split, root wrap — no longer remounts the WASM buffer.
export function XTermPane({
  paneId,
  sandboxId,
  repoId,
  workingBranch,
  terminalSessionKey,
}: Props) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const setAnchor = useTerminalSessionsStore((state) => state.setAnchor);
  const clearAnchorIfCurrent = useTerminalSessionsStore(
    (state) => state.clearAnchorIfCurrent
  );
  const setBinding = useTerminalSessionsStore((state) => state.setBinding);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    setAnchor(paneId, anchor);
    return () => clearAnchorIfCurrent(paneId, anchor);
  }, [clearAnchorIfCurrent, paneId, setAnchor]);

  useEffect(() => {
    setBinding(paneId, {
      sandboxId,
      repoId,
      workingBranch,
      terminalSessionKey,
    });
  }, [
    paneId,
    sandboxId,
    repoId,
    workingBranch,
    terminalSessionKey,
    setBinding,
  ]);

  return <div ref={anchorRef} className="h-full w-full" />;
}
