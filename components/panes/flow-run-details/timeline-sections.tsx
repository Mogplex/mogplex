"use client"

import { flowAgentRoleLabel } from "@/lib/flows/graph"
import {
  callStatusTone,
  dispatchEventKindLabel,
  dispatchOutcomeLabel,
  dispatchOutcomeTone,
  formatDuration,
  formatJson,
  getActiveFlowWaits,
  nodeRunStatusTone,
  readNodeRunRole,
  readNodeRunSummary,
} from "@/lib/flows/run-presentation"
import type { FlowRunDetail } from "@/lib/types"
import { roleBadgeTone } from "./primitives"

export function RunDispatchTimelineSection({ runDetail }: { runDetail: FlowRunDetail }) {
  return (
    <section className="space-y-3">
      <div className="text-sm font-medium text-foreground">Dispatch timeline</div>
      {runDetail.dispatch_events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No dispatch events recorded for this run.
        </div>
      ) : (
        <div className="space-y-3">
          {runDetail.dispatch_events.map((event) => {
            const eventMetadata = formatJson(event.metadata)
            return (
              <div key={event.id} className="rounded-lg border border-border bg-card/50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {dispatchEventKindLabel(event.event_kind)}
                  </span>
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${dispatchOutcomeTone(event.outcome)}`}
                  >
                    {dispatchOutcomeLabel(event.outcome)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                </div>
                {event.reason && <div className="mt-3 text-sm text-foreground">{event.reason}</div>}
                {eventMetadata && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Event metadata
                    </summary>
                    <pre className="mt-2 overflow-auto rounded-lg border border-border bg-background/80 p-3 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                      {eventMetadata}
                    </pre>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function RunExecutionSection({ runDetail }: { runDetail: FlowRunDetail }) {
  return (
    <section className="space-y-3">
      <div className="text-sm font-medium text-foreground">Node execution</div>
      {runDetail.node_runs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No node-level execution records were captured for this run.
        </div>
      ) : (
        <div className="space-y-3">
          {runDetail.node_runs.map((nodeRun) => {
            const outputJson = formatJson(nodeRun.output)
            const nodeRole = readNodeRunRole(nodeRun.output)
            const nodeSummary = readNodeRunSummary(nodeRun.output)
            const activeWait = getActiveFlowWaits(runDetail).find(
              (wait) => wait.node_id === nodeRun.node_id
            )
            const statusLabel = activeWait ? "waiting" : nodeRun.status
            return (
              <div key={nodeRun.id} className="rounded-lg border border-border bg-card/50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-2 py-1 text-[11px] ${nodeRunStatusTone(activeWait ? "pending" : nodeRun.status)}`}>
                    {nodeRun.node_label || nodeRun.node_id} · {statusLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">{nodeRun.node_type}</span>
                  {nodeRole && (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${roleBadgeTone(nodeRole)}`}
                    >
                      {flowAgentRoleLabel(nodeRole)}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(nodeRun.duration_ms)}
                  </span>
                </div>
                {nodeSummary && <div className="mt-3 text-sm text-foreground">{nodeSummary}</div>}
                {nodeRun.error && <div className="mt-3 text-sm text-accent-red">{nodeRun.error}</div>}
                {outputJson && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Node output
                    </summary>
                    <pre className="mt-2 overflow-auto rounded-lg border border-border bg-background/80 p-3 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                      {outputJson}
                    </pre>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function RunAiCallsSection({ runDetail }: { runDetail: FlowRunDetail }) {
  return (
    <section className="space-y-3">
      <div className="text-sm font-medium text-foreground">AI calls</div>
      {runDetail.ai_calls.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No AI calls were linked to this run.
        </div>
      ) : (
        <div className="space-y-3">
          {runDetail.ai_calls.map((call) => {
            const callMetadata = formatJson(call.metadata)
            return (
              <div key={call.id} className="rounded-lg border border-border bg-card/50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${callStatusTone(call.status)}`}
                  >
                    {call.status}
                  </span>
                  <span className="text-sm text-foreground">{call.model}</span>
                  <span className="text-xs text-muted-foreground">{call.type}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(call.duration_ms)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{call.input_tokens ?? 0} in</span>
                  <span>{call.output_tokens ?? 0} out</span>
                  <span>{call.tool_calls_count} tool call(s)</span>
                  <span>{new Date(call.started_at).toLocaleString()}</span>
                </div>
                {call.error && <div className="mt-3 text-sm text-accent-red">{call.error}</div>}
                {call.tool_calls.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Tool calls
                    </summary>
                    <div className="mt-2 space-y-2">
                      {call.tool_calls.map((toolCall, index) => {
                        const toolInput = formatJson(toolCall.input ?? toolCall.input_preview ?? null)
                        const toolOutput = formatJson(
                          toolCall.output ?? toolCall.output_preview ?? null
                        )
                        return (
                          <div
                            key={`${call.id}-${toolCall.name}-${index}`}
                            className="rounded-lg border border-border bg-background/80 p-3"
                          >
                            <div className="text-xs font-medium text-foreground">{toolCall.name}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {toolCall.duration_ms
                                ? formatDuration(toolCall.duration_ms)
                                : "No duration"}
                            </div>
                            {toolInput && (
                              <pre className="mt-2 overflow-auto rounded-md border border-border bg-card/60 p-2 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                                {toolInput}
                              </pre>
                            )}
                            {toolOutput && (
                              <pre className="mt-2 overflow-auto rounded-md border border-border bg-card/60 p-2 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                                {toolOutput}
                              </pre>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </details>
                )}
                {call.events.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Call events
                    </summary>
                    <div className="mt-2 space-y-2">
                      {call.events.map((event) => {
                        const eventPayload = formatJson(event.payload)
                        return (
                          <div
                            key={event.id}
                            className="rounded-lg border border-border bg-background/80 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                {event.event_type}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(event.created_at).toLocaleString()}
                              </span>
                              {event.tool_name && (
                                <span className="text-xs text-muted-foreground">{event.tool_name}</span>
                              )}
                            </div>
                            {event.message && (
                              <div className="mt-2 text-sm text-foreground">{event.message}</div>
                            )}
                            {eventPayload && (
                              <pre className="mt-2 overflow-auto rounded-md border border-border bg-card/60 p-2 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                                {eventPayload}
                              </pre>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </details>
                )}
                {callMetadata && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Call metadata
                    </summary>
                    <pre className="mt-2 overflow-auto rounded-lg border border-border bg-background/80 p-3 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                      {callMetadata}
                    </pre>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
