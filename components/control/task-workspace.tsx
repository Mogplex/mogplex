"use client";

import { useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { Eye, Folder, GitCompare, Notes, Terminal, Xmark } from "iconoir-react";
import type { UIMessage } from "ai";
import type { Repo, SandboxRecord } from "@/lib/types";
import { usePanelWidth } from "@/hooks/use-panel-width";
import { lastUserMessageText } from "@/lib/agents/ui-message-text";
import { collectChangedFiles } from "@/lib/control/changed-files";
import { ChangedFilesBar } from "@/components/sandbox-changes/changed-files-bar";
import { PaneErrorBoundary } from "@/components/pane-content/pane-error-boundary";
import { TaskFiles } from "./task-files";
import { TaskPreview } from "./task-preview";
import { TaskPlan } from "./task-plan";
import { TaskTerminal } from "./task-terminal";
import { ChangedFilesCard } from "./changed-files-card";
import { ArtifactSidePanel } from "./artifact-side-panel";
import { collectControlArtifacts } from "./artifact-side-panel-model";
import type { TaskTool, useTaskTools } from "./use-task-tools";
import "./task-workspace.css";

const TOOL_BUTTONS = [
  { id: "preview", label: "Preview", icon: Eye },
  { id: "changes", label: "Changes", icon: GitCompare },
  { id: "files", label: "Files", icon: Folder },
  { id: "plan", label: "Plan", icon: Notes },
] as const;
const TITLES: Record<TaskTool, string> = { preview: "Preview", changes: "Changes", files: "Files", plan: "Plan", artifacts: "Artifacts", sandboxes: "Sandboxes", worktrees: "Worktrees" };

export function TaskWorkspace({ sessionId, repo, sandbox, messages, terminalMessages, pending, tools, contextBar, sandboxes, worktrees, onSelectSandbox, onFeedback, children }: {
  sessionId: string;
  repo: Repo | null;
  sandbox: SandboxRecord | null;
  messages: UIMessage[];
  terminalMessages: UIMessage[];
  pending: boolean;
  tools: ReturnType<typeof useTaskTools>;
  contextBar: ReactNode;
  sandboxes: ReactNode;
  worktrees: ReactNode;
  onSelectSandbox: (id: string) => void;
  onFeedback: (text: string) => void;
  children: ReactNode;
}) {
  const { width, panelRef, resizerProps } = usePanelWidth({ storageKey: "mogplex.control.tools.width", defaultWidth: 520, minWidth: 320, maxWidth: 1000, handle: "left" });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const restoreFocus = (tool: string) => toolbarRef.current?.querySelector<HTMLButtonElement>(`[data-task-tool="${tool}"]`)?.focus();
  const closeTool = () => { tools.closeTool(); restoreFocus(tools.tool ?? "preview"); };
  const closeDrawer = () => { tools.closeDrawer(); restoreFocus("terminal"); };
  const [refreshToken, refresh] = useReducer(value => value + 1, 0);
  const wasPending = useRef(pending);
  useEffect(() => { if (wasPending.current && !pending) refresh(); wasPending.current = pending; }, [pending]);
  const changed = useMemo(() => collectChangedFiles(messages), [messages]);
  const artifacts = useMemo(() => collectControlArtifacts(messages), [messages]);
  const artifactKey = artifacts.map(artifact => artifact.id).join("|");
  const seenArtifacts = useRef<Record<string, string>>({});
  const { openTool, tool: selectedTool } = tools;
  useEffect(() => {
    if (!artifactKey || seenArtifacts.current[sessionId] === artifactKey) return;
    seenArtifacts.current[sessionId] = artifactKey;
    if (!selectedTool) openTool("artifacts");
  }, [artifactKey, sessionId, selectedTool, openTool]);
  const running = sandbox?.runtime_summary.status === "running";
  const previewUrl = sandbox?.runtime_summary.preview_url ?? undefined;
  const inactiveMessage = !repo ? "Connect a repository to use its workspace tools." : sandbox ? "Resume this sandbox in Preview to access its files." : "Start or select a sandbox to access its files.";
  const panel = (tool: TaskTool) => {
    switch (tool) {
      case "preview": return sandbox ? <TaskPreview key={sandbox.id} activeRepo={repo} sandboxId={sandbox.id} sandboxRecordId={sandbox.id} previewUrl={previewUrl} onSandboxChange={onSelectSandbox} onFeedback={onFeedback} /> : <div className="space-y-3 p-5 text-sm text-muted-foreground">
        <p>{repo ? "Select a sandbox for this task to open its preview." : "Connect a repository to use its workspace tools."}</p>
        {repo && <button type="button" onClick={() => tools.openTool("sandboxes")} className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted">Choose sandbox</button>}
      </div>;
      case "files": return running && sandbox ? <TaskFiles key={sandbox.id} sandboxId={sandbox.id} rootLabel={sandbox.root_directory ?? repo?.root_directory ?? "/"} /> : <p className="p-5 text-sm text-muted-foreground">{inactiveMessage}</p>;
      case "changes": return <div className="min-h-0 flex-1 overflow-auto">
        {running && sandbox ? <ChangedFilesBar sandboxId={sandbox.id} disabled={pending} refreshToken={refreshToken} defaultCommitMessage={lastUserMessageText(messages).split("\n")[0]?.slice(0, 72) ?? ""} presentation="panel" /> : changed.length ? <ChangedFilesCard messages={messages} /> : <p className="p-5 text-sm text-muted-foreground">{sandbox ? "Resume the sandbox to inspect its working changes." : "No changes recorded for this task yet."}</p>}
      </div>;
      case "plan": return <TaskPlan messages={messages} />;
      case "artifacts": return <ArtifactSidePanel messages={messages} />;
      case "sandboxes": return sandboxes;
      case "worktrees": return worktrees;
    }
  };
  return <div className="task-workspace flex min-h-0 flex-1 flex-col" data-tool-open={Boolean(tools.tool)} data-drawer-open={Boolean(tools.drawer)}>
    <div ref={toolbarRef} className="task-workspace-toolbar flex shrink-0 flex-wrap items-center gap-x-3 border-b border-border px-3 py-1">
      <div className="task-tool-buttons flex min-w-0 items-center gap-1 overflow-x-auto" role="group" aria-label="Task tools">
        {TOOL_BUTTONS.map(({ id, label, icon: Icon }) => <button key={id} data-task-tool={id} type="button" aria-label={`Open ${label.toLowerCase()}`} aria-pressed={tools.tool === id} onClick={() => tools.openTool(id)} className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-2 text-xs sm:gap-1.5 sm:px-2.5 transition-colors ${tools.tool === id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
          <Icon className="size-4" aria-hidden="true" />{label}{id === "changes" && changed.length > 0 && <span className="rounded bg-muted px-1 text-xs">{changed.length}</span>}
        </button>)}
        {artifacts.length > 0 && <button type="button" data-task-tool="artifacts" aria-label="Open artifacts" aria-pressed={tools.tool === "artifacts"} onClick={() => tools.openTool("artifacts")} className="shrink-0 rounded px-2 py-2 text-xs hover:bg-muted">Artifacts ({artifacts.length})</button>}
        <button type="button" data-task-tool="terminal" aria-label="Open terminal" aria-expanded={Boolean(tools.drawer)} onClick={() => tools.openDrawer("terminal")} className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-2 py-2 text-xs sm:gap-1.5 sm:px-2.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Terminal className="size-4" aria-hidden="true" /><span className="hidden sm:inline">Terminal</span></button>
      </div>
      {contextBar}
    </div>
    <div className="task-workspace-main relative flex min-h-0 flex-1 overflow-hidden">
      <div className="task-conversation flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      <aside ref={panelRef} aria-label="Task tools" className="task-tools relative min-h-0 shrink-0 flex-col border-l border-border bg-background" style={{ width, display: tools.tool ? "flex" : "none" }}>
        <div {...resizerProps} aria-label="Resize task tools" className="task-tools-resizer absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none focus-visible:bg-primary/20" />
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <span className="text-sm font-medium">{tools.tool ? TITLES[tools.tool] : "Task tools"}</span>
          <button type="button" aria-label="Close task tools" onClick={closeTool} className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Xmark className="size-4" /></button>
        </div>
        {tools.openedTools.map(tool => <div key={`${sessionId}:${tool}`} className="min-h-0 flex-1 flex-col overflow-auto" style={{ display: tools.tool === tool ? "flex" : "none" }}>
          <PaneErrorBoundary paneName={TITLES[tool]}>{panel(tool)}</PaneErrorBoundary>
        </div>)}
      </aside>
    </div>
    <TaskTerminal sessionId={sessionId} sandbox={sandbox} messages={terminalMessages} tools={tools} onClose={closeDrawer} />
  </div>;
}
