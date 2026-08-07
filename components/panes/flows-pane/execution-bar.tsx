"use client"

import { cn } from "@/lib/utils"
import { CheckCircle } from "iconoir-react"
import {
  formatRunSourceType,
  nodeRunStatusTone,
  runStatusTone,
  type FlowRunStatusLabel,
} from "@/lib/flows/run-presentation"
import type { FlowRunRecord } from "@/lib/types"

export interface ExecutionBarProps {
  latestFlowRun: FlowRunRecord | null
  latestFlowRunStatus: FlowRunStatusLabel | null
  onViewRuns: () => void
}

export function ExecutionBar({
  latestFlowRun,
  latestFlowRunStatus,
  onViewRuns,
}: ExecutionBarProps) {
  return (
    <div
      data-testid="flow-execution-log"
      className="flows-execution-log"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[9px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            Execution
          </span>
          {latestFlowRun ? (
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[9px] font-medium tracking-[0.12em] uppercase",
                runStatusTone(
                  latestFlowRunStatus ?? latestFlowRun.status,
                ),
              )}
            >
              {latestFlowRunStatus}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              No runs yet
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onViewRuns}
          className="shrink-0 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          View runs
        </button>
      </div>
      <div className="flex min-h-9 items-center gap-2 overflow-hidden px-3 py-2">
        {latestFlowRun ? (
          <>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {new Date(
                latestFlowRun.started_at || latestFlowRun.created_at,
              ).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="truncate text-[10px] text-muted-foreground">
              {formatRunSourceType(latestFlowRun.source_type)}
            </span>
            {latestFlowRun.node_runs.slice(-4).map((nodeRun) => (
              <span
                key={nodeRun.id}
                className={cn(
                  "shrink-0 rounded border px-1.5 py-0.5 text-[9px]",
                  nodeRunStatusTone(nodeRun.status),
                )}
              >
                {nodeRun.node_label || nodeRun.node_id} · {nodeRun.status}
              </span>
            ))}
          </>
        ) : (
          <>
            <CheckCircle className="size-3.5 shrink-0 text-accent-green" />
            <span className="truncate text-[10px] text-muted-foreground">
              Canvas ready · publish and activate to begin receiving events
            </span>
          </>
        )}
      </div>
    </div>
  )
}
