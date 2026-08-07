"use client"

import {
  dispatchOutcomeLabel,
  flowRunStatusLabel,
  formatRunSourceType,
  getRunLatestReason,
  nodeRunStatusTone,
  readNodeRunRole,
  readNodeRunSummary,
  runStatusTone,
  type FlowRunAction,
} from "@/lib/flows/run-presentation"
import { flowAgentRoleLabel } from "@/lib/flows/graph"
import type { FlowRunRecord } from "@/lib/types"
import { RunActionButtons, type ActiveRunActions } from "../flow-run-details"
import { getRoleTheme } from "./node-shells"

export interface RunsTabContentProps {
  flowRuns: FlowRunRecord[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  activeRunActions: ActiveRunActions
  onRunAction: (jobId: string, action: FlowRunAction) => void
}

export function RunsTabContent({
  flowRuns,
  selectedRunId,
  onSelectRun,
  activeRunActions,
  onRunAction,
}: RunsTabContentProps) {
  return (
    <div className="px-4 pb-4 pt-14 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="ui-kicker">Execution rail</div>
          <div className="mt-1 text-sm font-medium text-foreground">Run history</div>
          <div className="text-xs text-muted-foreground">See which reviewer, editor, and operator nodes executed, skipped, or failed.</div>
        </div>
        <div className="text-xs text-muted-foreground">
          {flowRuns.length > 0 ? `${flowRuns.length} recent run${flowRuns.length === 1 ? "" : "s"}` : "No runs yet"}
        </div>
      </div>
      {flowRuns.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border p-4 text-sm text-muted-foreground">
          No runs recorded for this flow yet.
        </div>
      ) : (
        <div className="space-y-3">
          {flowRuns.map((run) => {
            const reason = getRunLatestReason(run)
            const isSelectedRun = run.id === selectedRunId
            const statusLabel = flowRunStatusLabel(run)
            return (
              <div
                key={run.id}
                data-testid={`flow-run-card-${run.id}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelectRun(run.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onSelectRun(run.id)
                  }
                }}
                className={`cursor-pointer rounded-sm border p-4 transition-all ${
                  isSelectedRun
                    ? "border-accent-blue/35 bg-linear-to-br from-accent-blue/14 to-accent-green/5"
                    : "border-border/80 bg-background/80 hover:bg-secondary/50"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${runStatusTone(statusLabel)}`}>
                        {statusLabel}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatRunSourceType(run.source_type)}</span>
                      <span className="text-xs text-muted-foreground" title={run.created_at}>
                        {new Date(run.started_at || run.created_at).toLocaleString()}
                      </span>
                      {run.repo?.full_name && (
                        <span className="truncate text-xs text-muted-foreground">{run.repo.full_name}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{run.start_attempts} start attempt{run.start_attempts === 1 ? "" : "s"}</span>
                      {run.latest_dispatch_event && (
                        <span>{dispatchOutcomeLabel(run.latest_dispatch_event.outcome)}</span>
                      )}
                    </div>
                    {run.cancel_requested_at && (
                      <div className="text-xs text-muted-foreground">
                        {run.cancelled_at
                          ? "Cancelled"
                          : run.cancel_error
                            ? "Cancel failed"
                            : "Cancel requested"}
                      </div>
                    )}
                    {reason && (
                      <div className="text-xs text-muted-foreground">
                        Reason: <span className="text-foreground">{reason}</span>
                      </div>
                    )}
                  </div>
                  <RunActionButtons
                    run={run}
                    activeRunActions={activeRunActions}
                    onRunAction={(jobId, action) => {
                      onRunAction(jobId, action)
                    }}
                    className="justify-end"
                  />
                </div>
                {run.node_runs.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {run.node_runs.map((nodeRun) => {
                      const nodeRole = readNodeRunRole(nodeRun.output)
                      const summary = readNodeRunSummary(nodeRun.output)
                      return (
                        <span
                          key={nodeRun.id}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${nodeRunStatusTone(nodeRun.status)}`}
                          title={nodeRun.error || summary || nodeRun.node_id}
                        >
                          {nodeRole && (
                            <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                              getRoleTheme(nodeRole).badge
                            }`}>
                              {flowAgentRoleLabel(nodeRole)}
                            </span>
                          )}
                          <span>{nodeRun.node_label || nodeRun.node_id}</span>
                          <span className="text-current/70">· {nodeRun.status}</span>
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
