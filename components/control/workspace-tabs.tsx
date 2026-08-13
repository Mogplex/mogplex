"use client";

import { ChatBubble, GitBranch, ViewColumns3 } from "iconoir-react";
import type { SandboxRecord } from "@/lib/types";
import type { OrchestrationWorktreeDTO } from "@/lib/worktrees/types";

export type ControlView = "chat" | "worktrees" | "sandboxes";

const DOT_CLASS: Record<string, string> = {
  running: "bg-sky-400 animate-pulse",
  creating: "bg-sky-400 animate-pulse",
  installing: "bg-sky-400 animate-pulse",
  pausing: "bg-ink-400",
  stopped: "bg-ink-600",
  paused: "bg-ink-400",
  error: "bg-delr",
};

const TAB_BASE =
  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] whitespace-nowrap transition-colors";
const TAB_ON = "bg-ink-800 font-medium text-white";
const TAB_OFF = "text-ink-400 hover:bg-ink-850 hover:text-ink-200";

/**
 * Workspace switcher under the top bar. Worktree checkout counts and sandbox
 * compute counts stay separate; sandbox branch tabs focus the matching card.
 */
export function WorkspaceTabs({
  view,
  onViewChange,
  sandboxes,
  worktrees,
  selectedSandboxId,
  onFocusSandbox,
}: {
  view: ControlView;
  onViewChange: (view: ControlView) => void;
  sandboxes: SandboxRecord[];
  worktrees: OrchestrationWorktreeDTO[];
  selectedSandboxId: string | null;
  onFocusSandbox: (sandboxId: string) => void;
}) {
  return (
    <div className="border-ink-800 flex items-center gap-1 overflow-x-auto border-b px-4 py-2 sm:px-6">
      <button
        type="button"
        aria-pressed={view === "chat"}
        onClick={() => onViewChange("chat")}
        className={`${TAB_BASE} ${view === "chat" ? TAB_ON : TAB_OFF}`}
      >
        <ChatBubble className="size-3.5 shrink-0" strokeWidth={1.8} />
        Chat
      </button>
      <button
        type="button"
        aria-pressed={view === "worktrees"}
        onClick={() => onViewChange("worktrees")}
        className={`${TAB_BASE} ${view === "worktrees" ? TAB_ON : TAB_OFF}`}
      >
        <GitBranch className="size-3.5 shrink-0" strokeWidth={1.8} />
        Worktrees
        <span className="bg-ink-700 text-ink-200 rounded px-1.5 text-[10.5px] leading-4">
          {worktrees.length}
        </span>
      </button>
      <button
        type="button"
        aria-pressed={view === "sandboxes"}
        onClick={() => onViewChange("sandboxes")}
        className={`${TAB_BASE} ${view === "sandboxes" ? TAB_ON : TAB_OFF}`}
      >
        <ViewColumns3 className="size-3.5 shrink-0" strokeWidth={1.8} />
        Sandboxes
        <span className="bg-ink-700 text-ink-200 rounded px-1.5 text-[10.5px] leading-4">
          {sandboxes.length}
        </span>
      </button>
      {sandboxes.length > 0 ? (
        <div className="bg-ink-800 mx-1 h-4 w-px shrink-0" />
      ) : null}
      {sandboxes.map((sandbox) => (
        <button
          key={sandbox.id}
          type="button"
          aria-pressed={sandbox.id === selectedSandboxId}
          onClick={() => onFocusSandbox(sandbox.id)}
          className={`${TAB_BASE} ${sandbox.id === selectedSandboxId ? TAB_ON : TAB_OFF}`}
        >
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              DOT_CLASS[sandbox.runtime_summary.status] ?? "bg-ink-600"
            }`}
          />
          <span className="font-mono">{sandbox.working_branch}</span>
        </button>
      ))}
    </div>
  );
}
