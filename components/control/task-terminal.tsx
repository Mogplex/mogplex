"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Xmark } from "iconoir-react";
import type { UIMessage } from "ai";
import type { SandboxRecord } from "@/lib/types";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { useTerminalSessionsStore } from "@/hooks/use-terminal-sessions";
import { XTermPane } from "@/components/xterm-pane";
import { TerminalActivity } from "./terminal-activity";
import type { useTaskTools, TaskDrawer } from "./use-task-tools";

const TerminalSession = dynamic(() => import("@/components/terminal-session").then(module => module.TerminalSession), { ssr: false });
const TABS: Array<{ id: TaskDrawer; label: string }> = [{ id: "commands", label: "Agent commands" }, { id: "terminal", label: "Terminal" }, { id: "logs", label: "Logs" }];

function TaskShell({ sessionId, sandbox }: { sessionId: string; sandbox: SandboxRecord }) {
  const paneId = `control-${sessionId}-${sandbox.id}`;
  const clearSession = useTerminalSessionsStore(state => state.clearSession);
  useEffect(() => () => clearSession(paneId), [clearSession, paneId]);
  return <>
    <XTermPane paneId={paneId} sandboxId={sandbox.id} repoId={sandbox.repo_id} terminalSessionKey={paneId} showAgentCommands={false} />
    <TerminalSession paneId={paneId} />
  </>;
}

export function TaskTerminal({ sessionId, sandbox, messages, tools, onClose }: {
  sessionId: string; sandbox: SandboxRecord | null; messages: UIMessage[]; tools: ReturnType<typeof useTaskTools>; onClose: () => void;
}) {
  const [height, setHeight] = useState(240);
  const regionRef = useRef<HTMLElement | null>(null);
  const drag = useRef<{ pointer: number; bottom: number } | null>(null);
  const logs = useSandboxStore(state => sandbox ? state.getLaunchLogs(sandbox.repo_id, { sandboxId: sandbox.id }) : undefined);
  const clamp = (next: number) => Math.max(120, Math.min(window.innerHeight * 0.65, next));
  return <section ref={regionRef} aria-label="Task terminal" className="task-terminal relative shrink-0 border-t border-border bg-background" style={{ height, display: tools.drawer ? "flex" : "none" }}>
    <div role="separator" aria-label="Resize terminal" aria-orientation="horizontal" aria-valuemin={120} aria-valuenow={Math.round(height)} tabIndex={0}
      className="absolute inset-x-0 -top-1 z-20 h-2 cursor-row-resize touch-none focus-visible:bg-primary/20"
      onPointerDown={event => { drag.current = { pointer: event.pointerId, bottom: regionRef.current?.getBoundingClientRect().bottom ?? 0 }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current?.pointer === event.pointerId) setHeight(clamp(drag.current.bottom - event.clientY)); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); setHeight(current => clamp(current + (event.key === "ArrowUp" ? 24 : -24))); } }} />
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
      <div role="tablist" aria-label="Terminal views" className="flex min-w-0 gap-1" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = TABS.findIndex(tab => tab.id === tools.drawer);
        const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
        tools.openDrawer(TABS[next].id);
        event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }}>
        {TABS.map(tab => <button key={tab.id} type="button" role="tab" id={`task-drawer-${tab.id}`} aria-controls={`task-output-${tab.id}`} aria-selected={tools.drawer === tab.id} tabIndex={tools.drawer === tab.id ? 0 : -1} onClick={() => tools.openDrawer(tab.id)} className={`rounded px-2 py-1.5 text-xs ${tools.drawer === tab.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{tab.label}</button>)}
      </div>
      <button type="button" aria-label="Close terminal" onClick={onClose} className="ml-auto rounded p-2 hover:bg-muted"><Xmark className="size-4" /></button>
    </div>
    <div role="tabpanel" id="task-output-commands" aria-labelledby="task-drawer-commands" className="min-h-0 flex-1 overflow-auto" hidden={tools.drawer !== "commands"}>
      <TerminalActivity messages={messages} />
    </div>
    <div role="tabpanel" id="task-output-terminal" aria-labelledby="task-drawer-terminal" className="min-h-0 flex-1 overflow-hidden" hidden={tools.drawer !== "terminal"}>
      {sandbox && tools.terminalOpened ? <TaskShell key={`${sessionId}-${sandbox.id}`} sessionId={sessionId} sandbox={sandbox} /> : <p className="p-4 text-sm text-muted-foreground">Select a sandbox to open its terminal.</p>}
    </div>
    <div role="tabpanel" id="task-output-logs" aria-labelledby="task-drawer-logs" className="min-h-0 flex-1 overflow-auto" hidden={tools.drawer !== "logs"}>
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs text-muted-foreground">{logs || sandbox?.dev_log || sandbox?.install_log || "No sandbox logs recorded yet."}</pre>
    </div>
  </section>;
}
