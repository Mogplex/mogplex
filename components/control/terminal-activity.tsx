"use client";

import { useMemo } from "react";
import type { UIMessage } from "ai";
import {
  buildTerminalActivityEntries,
  type TerminalActivityEntry,
} from "@/lib/control/activity-stream";

const STATUS: Record<
  TerminalActivityEntry["state"],
  { label: string; dot: string; text: string }
> = {
  running: {
    label: "Running",
    dot: "bg-accent-blue animate-pulse",
    text: "text-accent-blue",
  },
  done: {
    label: "Complete",
    dot: "bg-accent-green",
    text: "text-ink-400",
  },
  failed: {
    label: "Failed",
    dot: "bg-accent-red",
    text: "text-accent-red",
  },
};

const SANDBOX_TITLE: Record<TerminalActivityEntry["state"], string> = {
  running: "Starting sandbox",
  done: "Sandbox ready",
  failed: "Sandbox failed",
};

const SANDBOX_FALLBACK: Record<TerminalActivityEntry["state"], string> = {
  running: "Automatic recovery will continue through any active cleanup…",
  done: "Sandbox state updated.",
  failed: "Sandbox failed to start.",
};

function TerminalRow({ entry }: { entry: TerminalActivityEntry }) {
  const status = STATUS[entry.state];
  const title =
    entry.kind === "sandbox" ? SANDBOX_TITLE[entry.state] : entry.command;
  const fallback =
    entry.kind === "sandbox"
      ? SANDBOX_FALLBACK[entry.state]
      : entry.state === "running"
        ? "Command is running…"
        : entry.state === "done"
          ? "Command completed."
          : "Command failed.";

  return (
    <div className="min-w-0 py-2.5 first:pt-0 last:pb-0">
      {entry.workerBranch && <p className="text-ink-500 mb-1 break-all font-mono text-[10px]">{entry.workerBranch}</p>}
      <div className="flex min-w-0 items-center gap-2 font-mono text-[11px]">
        <span aria-hidden="true" className="text-ink-500">
          {entry.kind === "command" ? "$" : "#"}
        </span>
        <span
          className="text-ink-200 min-w-0 flex-1 truncate"
          title={title ?? undefined}
        >
          {title}
        </span>
        <span className={`flex shrink-0 items-center gap-1.5 ${status.text}`}>
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${status.dot}`}
          />
          {status.label}
        </span>
      </div>
      <div className="text-ink-400 mt-1.5 space-y-0.5 pl-4 font-mono text-[11px] leading-5">
        {(entry.lines.length > 0 ? entry.lines : [fallback]).map(
          (line, index) => (
            <div key={`${entry.id}-${index}`} className="break-words">
              {line}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** Read-only command output for the current request and its workers. */
export function TerminalActivity({ messages }: { messages: UIMessage[] }) {
  const entries = useMemo(() => buildTerminalActivityEntries(messages, { fullOutput: true }), [messages]);
  return <div className="space-y-2 p-4 text-sm" data-testid="control-terminal-activity" aria-label="Agent command output">
    <p className="mb-3 text-xs text-muted-foreground">Commands for the current request. Read only.</p>
    {entries.length ? entries.map(entry => <TerminalRow key={entry.id} entry={entry} />) : <p className="text-muted-foreground">No commands recorded for this task yet.</p>}
  </div>;
}
