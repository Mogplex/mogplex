"use client";

import { useEffect, useMemo, useRef } from "react";
import type { UIMessage } from "ai";
import { Check, Circle, WarningCircle } from "iconoir-react";
import {
  buildActivityEntries,
  type ActivityEntry,
} from "@/lib/control/activity-stream";

function EntryLine({ entry }: { entry: ActivityEntry }) {
  if (entry.kind === "user") {
    return (
      <div className="text-secondary-foreground">
        <span className="text-muted-foreground">{"> "}</span>
        {entry.text}
      </div>
    );
  }

  if (entry.kind === "text") {
    return (
      <div className="text-foreground whitespace-pre-wrap">{entry.text}</div>
    );
  }

  if (entry.kind === "approval") {
    return (
      <div className="text-accent-amber flex items-center gap-1.5">
        <WarningCircle className="size-3.5 shrink-0" strokeWidth={1.8} />
        {entry.state === "requested"
          ? `waiting for approval: ${entry.name}`
          : `${entry.name} ${entry.state}`}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        {entry.state === "done" ? (
          <Check className="text-accent-green size-3.5 shrink-0" strokeWidth={2} />
        ) : entry.state === "failed" ? (
          <WarningCircle className="text-accent-red size-3.5 shrink-0" strokeWidth={1.8} />
        ) : (
          <Circle className="text-accent-blue size-3 shrink-0 animate-pulse" strokeWidth={2} />
        )}
        <span className="text-accent-blue">$</span>
        <span className="text-foreground">{entry.name}</span>
        <span className="text-muted-foreground truncate">{entry.input}</span>
      </div>
      {entry.state === "done" && entry.output && entry.output !== "…" ? (
        <div className="text-muted-foreground truncate pl-5">
          {entry.output}
        </div>
      ) : null}
      {entry.state === "failed" ? (
        <div className="text-accent-red truncate pl-5">{entry.error}</div>
      ) : null}
    </div>
  );
}

export function TerminalStream({
  messages,
  streaming,
}: {
  messages: UIMessage[];
  streaming: boolean;
}) {
  const entries = useMemo(() => buildActivityEntries(messages), [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, streaming]);

  return (
    <div
      ref={scrollRef}
      aria-label="Agent activity stream"
      className="bg-input max-h-full flex-1 space-y-1.5 overflow-y-auto rounded-lg p-3 font-mono text-xs leading-5"
    >
      {entries.length === 0 ? (
        <div className="text-muted-foreground">
          Agent activity will stream here once the run starts.
        </div>
      ) : (
        entries.map((entry) => <EntryLine key={entry.id} entry={entry} />)
      )}
      {streaming ? (
        <div className="mt-1 inline-block h-4 w-2 animate-pulse bg-foreground" />
      ) : null}
    </div>
  );
}
