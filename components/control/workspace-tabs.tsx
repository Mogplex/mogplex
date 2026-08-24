"use client";

import {
  Check,
  ChatBubble,
  GitBranch,
  NavArrowDown,
  Server,
} from "iconoir-react";
import type { KeyboardEvent } from "react";
import type { SandboxRecord } from "@/lib/types";
import type { OrchestrationWorktreeDTO } from "@/lib/worktrees/types";
import { partitionControlSandboxes } from "@/lib/control/sandbox-presentation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

function shortRuntimeId(runtimeId: string) {
  const withoutPrefix = runtimeId.replace(/^sbx[_-]?/, "");
  return withoutPrefix.length <= 8
    ? withoutPrefix
    : withoutPrefix.slice(-8);
}

function readableSandboxKey(
  repositoryName: string,
  sandbox: SandboxRecord
) {
  return [
    repositoryName,
    sandbox.working_branch,
    sandbox.root_directory || "",
  ].join("\u0000");
}

type SandboxChoice = {
  sandbox: SandboxRecord;
  runtimeId: string;
  runtimeStatus: string;
  shortId: string | null;
};

function sandboxChoices(
  sandboxes: SandboxRecord[],
  repositoryName: string
): SandboxChoice[] {
  const readableCounts = new Map<string, number>();
  for (const sandbox of sandboxes) {
    const key = readableSandboxKey(repositoryName, sandbox);
    readableCounts.set(key, (readableCounts.get(key) ?? 0) + 1);
  }
  return sandboxes.map((sandbox) => {
    const runtimeId = sandbox.runtime_summary.sandbox_id || sandbox.id;
    const duplicateReadableLabel =
      (readableCounts.get(readableSandboxKey(repositoryName, sandbox)) ?? 0) >
      1;
    return {
      sandbox,
      runtimeId,
      runtimeStatus: statusLabel(sandbox.runtime_summary.status),
      shortId: duplicateReadableLabel ? shortRuntimeId(runtimeId) : null,
    };
  });
}

function sandboxChoiceDescription(
  choice: SandboxChoice,
  repositoryName: string
) {
  const root = choice.sandbox.root_directory
    ? `, root ${choice.sandbox.root_directory}`
    : "";
  const disambiguator = choice.shortId
    ? `, sandbox ${choice.shortId}`
    : "";
  return `${repositoryName}, branch ${choice.sandbox.working_branch}${root}, ${choice.runtimeStatus}${disambiguator}`;
}

function SandboxChoiceContent({
  choice,
  repositoryName,
}: {
  choice: SandboxChoice;
  repositoryName: string;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${
          DOT_CLASS[choice.sandbox.runtime_summary.status] ?? "bg-ink-600"
        }`}
      />
      <span className="min-w-0 flex-1 truncate text-left">
        <span className="font-medium">{repositoryName}</span>
        <span className="text-ink-500 mx-1">·</span>
        <span className="font-mono">{choice.sandbox.working_branch}</span>
        {choice.sandbox.root_directory ? (
          <>
            <span className="text-ink-500 mx-1">·</span>
            <span className="text-ink-400 font-mono">
              {choice.sandbox.root_directory}
            </span>
          </>
        ) : null}
      </span>
      <span className="text-ink-400 shrink-0 text-[10.5px]">
        {choice.runtimeStatus}
        {choice.shortId ? ` · ${choice.shortId}` : ""}
      </span>
    </>
  );
}

function SandboxChoiceMenu({
  choices,
  selectedSandboxId,
  repositoryName,
  onSelect,
}: {
  choices: SandboxChoice[];
  selectedSandboxId: string | null;
  repositoryName: string;
  onSelect: (sandboxId: string) => void;
}) {
  return (
    <DropdownMenuContent
      align="end"
      className="border-ink-700 bg-ink-900 text-ink-100 w-80 max-w-[calc(100vw-2rem)]"
    >
      {choices.map((choice) => {
        const selected = choice.sandbox.id === selectedSandboxId;
        return (
          <DropdownMenuItem
            key={choice.sandbox.id}
            aria-current={selected ? "true" : undefined}
            aria-label={`Select ${sandboxChoiceDescription(choice, repositoryName)}, for chat and preview`}
            title={choice.runtimeId}
            onSelect={() => onSelect(choice.sandbox.id)}
            className="focus:bg-ink-800 focus:text-white gap-2 text-[12.5px]"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <SandboxChoiceContent
                choice={choice}
                repositoryName={repositoryName}
              />
            </span>
            {selected ? (
              <Check
                aria-label="Selected"
                className="text-flame-400 size-3.5 shrink-0"
              />
            ) : null}
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuContent>
  );
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
  repositoryName,
  selectedSandboxId,
  onFocusSandbox,
}: {
  view: ControlView;
  onViewChange: (view: ControlView) => void;
  sandboxes: SandboxRecord[];
  worktrees: OrchestrationWorktreeDTO[];
  repositoryName: string;
  selectedSandboxId: string | null;
  onFocusSandbox: (sandboxId: string) => void;
}) {
  const { current, history } = partitionControlSandboxes(sandboxes);
  const choices = sandboxChoices(current, repositoryName);
  const selectedChoice =
    choices.find((choice) => choice.sandbox.id === selectedSandboxId) ??
    choices[0] ??
    null;
  const desktopChoices = selectedChoice ? [selectedChoice] : [];
  const desktopChoiceIds = new Set(
    desktopChoices.map((choice) => choice.sandbox.id)
  );
  const overflowChoices = choices.filter(
    (choice) => !desktopChoiceIds.has(choice.sandbox.id)
  );
  return (
    <div className="border-ink-800 flex min-w-0 flex-wrap items-center gap-1 overflow-hidden border-b px-4 py-2 sm:px-6 xl:flex-nowrap">
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
        <div className="bg-ink-800 mx-1 hidden h-4 w-px shrink-0 xl:block" />
      ) : null}
      {selectedChoice ? (
        <div
          role="group"
          aria-label="Sandbox used by chat and preview"
          className="flex w-full min-w-0 flex-none justify-start overflow-hidden pt-1 xl:w-auto xl:flex-1 xl:justify-end xl:pt-0"
        >
          <div className="hidden min-w-0 items-center justify-end gap-1 overflow-hidden xl:flex">
            {desktopChoices.map((choice) => {
              const selected = choice.sandbox.id === selectedSandboxId;
              return (
                <button
                  key={choice.sandbox.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Select ${sandboxChoiceDescription(choice, repositoryName)}, for chat and preview`}
                  title={choice.runtimeId}
                  onClick={() => onFocusSandbox(choice.sandbox.id)}
                  className={`${TAB_BASE} max-w-72 ${selected ? TAB_ON : TAB_OFF}`}
                >
                  <SandboxChoiceContent
                    choice={choice}
                    repositoryName={repositoryName}
                  />
                </button>
              );
            })}
            {overflowChoices.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Choose from ${overflowChoices.length} more sandboxes`}
                    className={`${TAB_BASE} ${TAB_OFF}`}
                  >
                    +{overflowChoices.length}
                    <NavArrowDown className="size-3 shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <SandboxChoiceMenu
                  choices={overflowChoices}
                  selectedSandboxId={selectedSandboxId}
                  repositoryName={repositoryName}
                  onSelect={onFocusSandbox}
                />
              </DropdownMenu>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 xl:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Selected sandbox ${sandboxChoiceDescription(selectedChoice, repositoryName)}. Choose sandbox for chat and preview`}
                  title={selectedChoice.runtimeId}
                  className={`${TAB_BASE} ${TAB_ON} w-full max-w-full`}
                >
                  <SandboxChoiceContent
                    choice={selectedChoice}
                    repositoryName={repositoryName}
                  />
                  <NavArrowDown className="size-3 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <SandboxChoiceMenu
                choices={choices}
                selectedSandboxId={selectedSandboxId}
                repositoryName={repositoryName}
                onSelect={onFocusSandbox}
              />
            </DropdownMenu>
          </div>
        </div>
      ) : null}
    </div>
  );
}
