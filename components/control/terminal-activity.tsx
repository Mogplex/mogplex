"use client";

import { Terminal } from "iconoir-react";
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

function TerminalRow({ entry }: { entry: TerminalActivityEntry }) {
  const status = STATUS[entry.state];
  const title =
    entry.kind === "sandbox"
      ? entry.state === "running"
        ? "Starting sandbox"
        : "Sandbox ready"
      : entry.command;
  const fallback =
    entry.kind === "sandbox"
      ? entry.state === "running"
        ? "Waiting for remote compute to start…"
        : "Sandbox state updated."
      : entry.state === "running"
        ? "Command is running…"
        : entry.state === "done"
          ? "Command completed."
          : "Command failed.";

  return (
    <div className="min-w-0 py-2.5 first:pt-0 last:pb-0">
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
  const entries = buildTerminalActivityEntries(messages);
  if (entries.length === 0) return null;

  const visibleEntries = entries.slice(-3);
  const current = visibleEntries.at(-1);
  const sandboxId = current?.sandboxId;

  return (
    <section
      data-testid="control-terminal-activity"
      aria-label="Live sandbox terminal"
      aria-live="polite"
      aria-atomic="false"
      className="mx-auto mb-3 w-full max-w-[67rem] shrink-0 px-4 sm:px-6"
    >
      <div
        data-testid="control-terminal-surface"
        className="border-ink-800 bg-ink-950 overflow-hidden rounded-xl border shadow-sm shadow-black/20"
      >
        <div className="border-ink-800 bg-ink-900/70 flex min-w-0 items-center gap-2 border-b px-4 py-2">
          <Terminal
            className="text-ink-300 size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span className="text-ink-300 text-[11px] font-semibold tracking-[0.12em] uppercase">
            Live terminal
          </span>
          {sandboxId ? (
            <span className="text-ink-500 min-w-0 truncate font-mono text-[10.5px]">
              {sandboxId}
            </span>
          ) : null}
          <span className="text-ink-500 ml-auto shrink-0 text-[10px] font-medium tracking-wide uppercase">
            Read only
          </span>
        </div>
        <div className="divide-ink-900 divide-y px-4 py-3">
          {visibleEntries.map((entry) => (
            <TerminalRow key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </section>
  );
}
