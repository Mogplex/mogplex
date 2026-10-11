"use client";

import {
  Check,
  GitBranch,
  NavArrowDown,
  Server,
} from "iconoir-react";
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

/** Repository environment tools beside the task's preview/file controls. */
export function WorkspaceTabs({ view, onViewChange, sandboxes, worktrees, repositoryName, selectedSandboxId, onFocusSandbox }: {
  view: ControlView;
  onViewChange: (view: ControlView) => void;
  sandboxes: SandboxRecord[];
  worktrees: OrchestrationWorktreeDTO[];
  repositoryName: string;
  selectedSandboxId: string | null;
  onFocusSandbox: (sandboxId: string) => void;
}) {
  const { current, history } = partitionControlSandboxes(sandboxes);
  const selectedHistory = history.find(sandbox => sandbox.id === selectedSandboxId);
  const choices = sandboxChoices(selectedHistory ? [selectedHistory, ...current] : current, repositoryName);
  const selectedChoice = choices.find(choice => choice.sandbox.id === selectedSandboxId) ?? null;
  return <div className="flex min-w-0 items-center gap-1" role="group" aria-label="Task environment">
    <button type="button" data-task-tool="worktrees" aria-label={`Worktrees, ${countLabel(worktrees.length, "checkout")}`} aria-pressed={view === "worktrees"} onClick={() => onViewChange(view === "worktrees" ? "chat" : "worktrees")} className={`${TAB_BASE} ${view === "worktrees" ? TAB_ON : TAB_OFF}`}>
      <GitBranch className="size-4 shrink-0" aria-hidden="true" /><span className="hidden 2xl:inline">Worktrees</span><span className="text-xs">{worktrees.length}</span>
    </button>
    <button type="button" data-task-tool="sandboxes" aria-label={`Sandboxes, ${countLabel(current.length, "current sandbox", "current sandboxes")}, ${countLabel(history.length, "previous attempt")}`} aria-pressed={view === "sandboxes"} onClick={() => onViewChange(view === "sandboxes" ? "chat" : "sandboxes")} className={`${TAB_BASE} ${view === "sandboxes" ? TAB_ON : TAB_OFF}`}>
      <Server className="size-4 shrink-0" aria-hidden="true" /><span className="hidden 2xl:inline">Sandboxes</span><span className="text-xs">{current.length}</span>
    </button>
    {choices.length > 0 && <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={selectedChoice ? `Selected sandbox ${sandboxChoiceDescription(selectedChoice, repositoryName)}. Choose sandbox for chat and preview` : "Choose sandbox for this task"} title={selectedChoice?.runtimeId} className={`${TAB_BASE} ${TAB_OFF} min-w-0 max-w-80`}>
          {selectedChoice ? <SandboxChoiceContent choice={selectedChoice} repositoryName={repositoryName} /> : <span>Choose sandbox</span>}
          <NavArrowDown className="size-3 shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <SandboxChoiceMenu choices={choices} selectedSandboxId={selectedSandboxId} repositoryName={repositoryName} onSelect={onFocusSandbox} />
    </DropdownMenu>}
  </div>;
}
