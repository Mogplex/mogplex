"use client";

import { NavArrowDown, Terminal } from "iconoir-react";
import { useId, useMemo, useState } from "react";
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

/** Read-only execution feedback, attached to the composer instead of a new tab. */
export function TerminalActivity({ messages }: { messages: UIMessage[] }) {
  const [expanded, setExpanded] = useState(false);
  const outputId = useId();
  const entries = useMemo(
    () => buildTerminalActivityEntries(messages).filter((entry) => entry.state !== "running" || entry.lines.length > 0),
    [messages]
  );
  if (entries.length === 0) return null;

  const visibleEntries = entries.slice(-3);
  const latest = entries.at(-1)!;
  const latestTitle = latest.kind === "sandbox" ? SANDBOX_TITLE[latest.state] : latest.command;

  return (
    <section
      data-testid="control-terminal-activity"
      aria-label="Agent terminal, read only"
      aria-live="polite"
      aria-atomic="false"
      className="mx-auto mb-3 w-full max-w-[67rem] shrink-0 px-4 sm:px-6"
    >
      <div
        data-testid="control-terminal-surface"
        className="border-ink-800 bg-ink-950 overflow-hidden rounded-xl border shadow-sm shadow-black/20"
      >
        <button type="button" aria-label={expanded ? "Hide terminal output" : "Show terminal output"} aria-expanded={expanded} aria-controls={outputId} onClick={() => setExpanded(!expanded)} className="bg-ink-900/70 hover:bg-ink-900 focus-visible:outline-ring flex w-full min-w-0 items-center gap-2 px-4 py-2.5 text-left focus-visible:outline-2">
          <Terminal
            className="text-ink-300 size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span className="text-ink-300 text-[11px] font-semibold tracking-[0.12em] uppercase">
            Agent Terminal
          </span>
          <span className="text-ink-400 min-w-0 flex-1 truncate font-mono text-xs">{latestTitle}</span>
          <span className={`shrink-0 text-xs ${STATUS[latest.state].text}`}>{STATUS[latest.state].label}</span>
          <span className="text-accent-blue ml-auto shrink-0 text-[10px] font-medium tracking-wide uppercase">
            READ ONLY
          </span>
          <NavArrowDown aria-hidden="true" className={`text-ink-400 size-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        <div id={outputId} hidden={!expanded} className="border-ink-800 border-t divide-ink-900 max-h-36 overflow-y-auto sm:max-h-48 divide-y px-4 py-3">
          {entries.length > 3 && <details className="text-ink-400 mb-3 text-xs">
            <summary className="cursor-pointer py-1">Show {entries.length - 3} earlier commands</summary>
            <div className="mt-2 max-h-64 overflow-auto">
              {entries.slice(0, -3).map((entry) => <TerminalRow key={entry.id} entry={entry} />)}
            </div>
          </details>}
          {visibleEntries.map((entry) => (
            <TerminalRow key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </section>
  );
}
