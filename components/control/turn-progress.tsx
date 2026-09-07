"use client";

import type { UIMessage } from "ai";
import { RefreshDouble, WarningTriangle } from "iconoir-react";
import { workerSummary, type ControlWorker } from "@/lib/control/workers";
import { presentTurnProgress } from "@/lib/control/turn-progress";

export function TurnProgress({ messages, status, workers = [] }: { messages: UIMessage[]; status: string; workers?: ControlWorker[] }) {
  const working = workers.some((worker) => ["pending", "streaming", "awaiting_input"].includes(worker.status));
  const progress = presentTurnProgress(messages, status) ?? (working ? {
    label: workerSummary(workers),
    detail: null,
    completed: 0,
    failed: 0,
    approval: workers.some((worker) => worker.status === "awaiting_input"),
  } : null);
  if (!progress) return null;
  const Icon = progress.approval ? WarningTriangle : RefreshDouble;
  return (
    <div role="status" aria-live="polite" aria-label="Current activity" className="mx-auto flex w-full max-w-[67rem] items-start gap-3 px-5 py-3 sm:px-7">
      <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 text-accent-blue ${progress.approval ? "" : "motion-safe:animate-spin"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-foreground text-sm font-medium">{progress.label}</span>
          {progress.completed > 0 && <span className="text-muted-foreground text-xs">{progress.completed} action{progress.completed === 1 ? "" : "s"} finished{progress.failed ? ` · ${progress.failed} failed` : ""}</span>}
        </div>
        {working && progress.label !== workerSummary(workers) && <p className="text-muted-foreground mt-1 text-xs">{workerSummary(workers)}</p>}
        {progress.detail && <p className="text-muted-foreground mt-1 truncate font-mono text-xs" title={progress.detail}>{progress.detail}</p>}
      </div>
    </div>
  );
}
