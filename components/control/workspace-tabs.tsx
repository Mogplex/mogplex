"use client";

import { ChatBubble, GitBranch, Server } from "iconoir-react";
import type { KeyboardEvent } from "react";
import type { SandboxRecord } from "@/lib/types";
import type { OrchestrationWorktreeDTO } from "@/lib/worktrees/types";
import { partitionControlSandboxes } from "@/lib/control/sandbox-presentation";

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

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const supportedKeys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!supportedKeys.includes(event.key)) return;

  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  );
  const currentIndex = tabs.indexOf(
    document.activeElement as HTMLButtonElement
  );
  if (currentIndex < 0) return;

  event.preventDefault();
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

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
  const { current, history } = partitionControlSandboxes(sandboxes);
  return (
    <div className="border-ink-800 flex items-center gap-1 overflow-x-auto border-b px-4 py-2 sm:px-6">
      <div
        role="tablist"
        aria-label="Control views"
        onKeyDown={handleTabKeyDown}
        className="flex shrink-0 items-center gap-1"
      >
        <button
          type="button"
          role="tab"
          id="control-chat-tab"
          aria-controls="control-chat-panel"
          aria-selected={view === "chat"}
          aria-label="Chat"
          tabIndex={view === "chat" ? 0 : -1}
          onClick={() => onViewChange("chat")}
          className={`${TAB_BASE} ${view === "chat" ? TAB_ON : TAB_OFF}`}
        >
          <ChatBubble className="size-3.5 shrink-0" strokeWidth={1.8} />
          Chat
        </button>
        <button
          type="button"
          role="tab"
          id="control-worktrees-tab"
          aria-controls="control-worktrees-panel"
          aria-selected={view === "worktrees"}
          aria-label={`Worktrees, ${countLabel(worktrees.length, "checkout")}`}
          tabIndex={view === "worktrees" ? 0 : -1}
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
          role="tab"
          id="control-sandboxes-tab"
          aria-controls="control-sandboxes-panel"
          aria-selected={view === "sandboxes"}
          aria-label={`Sandboxes, ${countLabel(current.length, "current sandbox", "current sandboxes")}, ${countLabel(history.length, "previous attempt")}`}
          tabIndex={view === "sandboxes" ? 0 : -1}
          onClick={() => onViewChange("sandboxes")}
          className={`${TAB_BASE} ${view === "sandboxes" ? TAB_ON : TAB_OFF}`}
        >
          <Server className="size-3.5 shrink-0" strokeWidth={1.8} />
          Sandboxes
          <span className="bg-ink-700 text-ink-200 rounded px-1.5 text-[10.5px] leading-4">
            {current.length}
          </span>
        </button>
      </div>
      {current.length > 0 ? (
        <div className="bg-ink-800 mx-1 h-4 w-px shrink-0" />
      ) : null}
      <div
        role="group"
        aria-label="Sandbox used by chat and preview"
        className="flex items-center gap-1"
      >
        {current.map((sandbox) => {
          const selected = sandbox.id === selectedSandboxId;
          const runtimeId = sandbox.runtime_summary.sandbox_id || sandbox.id;
          const runtimeStatus = statusLabel(sandbox.runtime_summary.status);
          return (
            <button
              key={sandbox.id}
              type="button"
              aria-pressed={selected}
              aria-label={`Select sandbox ${runtimeId}, ${runtimeStatus}, repository branch ${sandbox.working_branch}, for chat and preview`}
              onClick={() => onFocusSandbox(sandbox.id)}
              className={`${TAB_BASE} ${selected ? TAB_ON : TAB_OFF}`}
            >
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${
                  DOT_CLASS[sandbox.runtime_summary.status] ?? "bg-ink-600"
                }`}
              />
              <span className="font-mono">{runtimeId}</span>
              <span className="text-ink-500 hidden max-w-36 truncate font-mono lg:inline">
                {sandbox.working_branch}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
