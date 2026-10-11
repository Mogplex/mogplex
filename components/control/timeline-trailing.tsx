"use client";

import { useMemo } from "react";
import type { UIMessage } from "ai";
import { GitCompare, Terminal } from "iconoir-react";
import { collectChangedFiles } from "@/lib/control/changed-files";
import { buildTerminalActivityEntries } from "@/lib/control/activity-stream";
import { MissionExecutionStatus } from "./coordinator-followup";
import type { useControlWorkers } from "./use-control-workers";

/** Results lead into the task's persistent tools without duplicating their UI. */
export function TimelineTrailing({ messages, chatPending, sandboxId, sessionId, workers, onOpenChanges, onOpenCommands }: {
  messages: UIMessage[];
  chatPending: boolean;
  sandboxId: string | null;
  sessionId: string | null;
  workers: ReturnType<typeof useControlWorkers>;
  onOpenChanges: () => void;
  onOpenCommands: () => void;
}) {
  const changed = useMemo(() => collectChangedFiles(messages), [messages]);
  const commands = useMemo(() => buildTerminalActivityEntries([...messages, ...workers.messages]), [messages, workers.messages]);
  return <>
    {(sandboxId || changed.length > 0 || commands.length > 0) && <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Task results">
      {(sandboxId || changed.length > 0) && <button type="button" onClick={onOpenChanges} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><GitCompare className="size-4" />Review changes{changed.length > 0 ? ` (${changed.length})` : ""}</button>}
      {commands.length > 0 && <button type="button" onClick={onOpenCommands} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><Terminal className="size-4" />Agent commands ({commands.length})</button>}
    </div>}
    <MissionExecutionStatus compact={chatPending} sessionId={sessionId} workers={workers.workers} error={workers.error} loading={workers.loading} onRefresh={workers.refresh} />
  </>;
}
