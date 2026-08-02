"use client"

import type { ReactNode } from "react"
import { flowAgentRoleLabel } from "@/lib/flows/graph"
import {
  callStatusTone,
  dispatchEventKindLabel,
  dispatchOutcomeLabel,
  dispatchOutcomeTone,
  formatDuration,
  formatJson,
  formatReviewFindingLocation,
  formatRunSourceType,
  collectRunEditDiffs,
  flowRunStatusLabel,
  flowWaitDescription,
  getActiveFlowWaits,
  getRunActionDescriptors,
  getRunActionEmptyState,
  getRunCancellationState,
  getRunLatestReason,
  readNodeRunRole,
  readNodeRunSummary,
  resolveReviewFindingIssueLink,
  nodeRunStatusTone,
  resolveReviewedTargetLink,
  reviewFindingSeverityLabel,
  reviewFindingSeverityTone,
  runStatusTone,
  type FlowRunAction,
} from "@/lib/flows/run-presentation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { PatchViewer } from "@/components/diffs/patch-viewer"
import type { FlowAgentNodeRole, FlowRunDetail, FlowRunRecord } from "@/lib/types"

type ActionableRun = Pick<
  FlowRunRecord,
  "id" | "status" | "cancelable" | "repairable" | "requeueable"
>

export type ActiveRunActions = Partial<Record<string, FlowRunAction>>

type FlowRunDetailsDialogProps = {
  open: boolean
  runDetail: FlowRunDetail | null
  runSummary: FlowRunRecord | null
  loading: boolean
  error: unknown
  activeRunActions: ActiveRunActions
  reviewFindingIssueActionId: string | null
  onOpenChange: (open: boolean) => void
  onRunAction: (jobId: string, action: FlowRunAction) => void | Promise<void>
  onCreateReviewFindingIssue: (findingId: string) => void | Promise<void>
}

function roleBadgeTone(role: FlowAgentNodeRole) {
  switch (role) {
    case "edit":
      return "border-accent-green/20 bg-accent-green/[0.08] text-accent-green"
    case "triage":
      return "border-accent-violet/20 bg-accent-violet/[0.08] text-accent-violet"
    case "review":
    default:
      return "border-accent-blue/20 bg-accent-blue/[0.08] text-accent-blue"
  }
}

function OverviewField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string
  value: ReactNode
  detail: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-lg font-medium text-foreground">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </div>
  )
}

export function RunActionButtons({
  run,
  activeRunActions,
  onRunAction,
  size = "sm",
  className,
}: {
  run: ActionableRun
  activeRunActions: ActiveRunActions
  onRunAction: (jobId: string, action: FlowRunAction) => void | Promise<void>
  size?: "sm" | "default"
  className?: string
}) {
  const actions = getRunActionDescriptors(run)

  if (actions.length === 0) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {actions.map((descriptor) => {
        const activeAction = activeRunActions[run.id]
        const pending = activeAction === descriptor.action
        // disabled only when this specific run has an action in flight
        const disabled = activeAction !== undefined
        const variant =
          descriptor.emphasis === "primary"
            ? "default"
            : descriptor.emphasis === "destructive"
              ? "destructive"
              : "secondary"

        return (
          <Button
            key={descriptor.action}
            type="button"
            variant={variant}
            size={size}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation()
              void onRunAction(run.id, descriptor.action)
            }}
            className={descriptor.emphasis === "destructive" ? "shadow-none" : undefined}
          >
            {pending && <Spinner className="size-3.5" />}
            {descriptor.label}
          </Button>
        )
      })}
    </div>
  )
}

function RunDetailsHeader({
  runDetail,
  runSummary,
}: {
  runDetail: FlowRunDetail | null
  runSummary: FlowRunRecord | null
}) {
  const run = runDetail ?? runSummary
  const statusLabel = runDetail ? flowRunStatusLabel(runDetail) : run?.status

  return (
    <DialogHeader className="border-b border-border px-6 py-5">
      <DialogTitle className="flex flex-wrap items-center gap-3 text-base">
        <span>Run details</span>
        {run && (
          <>
            <span
              className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${runStatusTone(statusLabel ?? run.status)}`}
            >
              {statusLabel}
            </span>
            <span className="text-sm font-normal text-muted-foreground">
              {formatRunSourceType(run.source_type)}
            </span>
          </>
        )}
      </DialogTitle>
      <DialogDescription>
        {run
          ? `${run.repo?.full_name || "Flow run"} · started ${new Date(run.started_at || run.created_at).toLocaleString()}`
          : "Inspect the dispatch timeline, node execution, AI calls, and metadata for this run."}
      </DialogDescription>
    </DialogHeader>
  )
}

function RunDetailsOverview({ runDetail }: { runDetail: FlowRunDetail }) {
  const reviewedTarget = resolveReviewedTargetLink(runDetail)
  const latestReason = getRunLatestReason(runDetail)
  const cancellationState = getRunCancellationState(runDetail)
  const metadata = formatJson(runDetail.metadata)

  return (
    <>
      <section className="space-y-3">
        <div className="text-sm font-medium text-foreground">Overview</div>
        <div className="rounded-lg border border-border bg-card/50 px-4">
          <OverviewField label="Repository">
            <div className="break-words">{runDetail.repo?.full_name || "n/a"}</div>
          </OverviewField>
          <OverviewField label="Reviewed target">
            {reviewedTarget ? (
              <a
                href={reviewedTarget.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded border border-border px-2.5 py-1 text-xs transition-colors hover:border-accent-blue/30 hover:bg-accent-blue/[0.08] hover:text-accent-blue"
              >
                {reviewedTarget.label}
              </a>
            ) : (
              "n/a"
            )}
          </OverviewField>
          <OverviewField label="Source">
            {formatRunSourceType(runDetail.source_type)}
          </OverviewField>
          <OverviewField label="Started">
            {runDetail.started_at ? new Date(runDetail.started_at).toLocaleString() : "n/a"}
          </OverviewField>
          <OverviewField label="Completed">
            {runDetail.completed_at ? new Date(runDetail.completed_at).toLocaleString() : "n/a"}
          </OverviewField>
        </div>
      </section>

      {latestReason && (
        <section className="space-y-3">
          <div className="text-sm font-medium text-foreground">Latest reason</div>
          <div className="rounded-lg border border-border bg-card/50 p-4 text-sm text-foreground">
            {latestReason}
          </div>
        </section>
      )}

      {cancellationState && (
        <section className="space-y-3">
          <div className="text-sm font-medium text-foreground">Cancellation</div>
          <div className="rounded-lg border border-border bg-card/50 p-4 text-sm text-muted-foreground">
            <div className="text-foreground">{cancellationState.label}</div>
            <div className="mt-2">{cancellationState.detail}</div>
            {cancellationState.finalizedByReconciliation && (
              <div className="mt-2 text-xs text-muted-foreground">
                Finalized by reconciliation after the original cancel request.
              </div>
            )}
          </div>
        </section>
      )}

      <details className="rounded-lg border border-border bg-card/50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Technical details
        </summary>
        <div className="mt-4 divide-y divide-border">
          <OverviewField label="Last start source">
            {runDetail.last_start_source || "n/a"}
          </OverviewField>
          <OverviewField label="Cancellation requested">
            {runDetail.cancel_requested_at
              ? new Date(runDetail.cancel_requested_at).toLocaleString()
              : "n/a"}
          </OverviewField>
          <OverviewField label="Cancelled at">
            {runDetail.cancelled_at
              ? new Date(runDetail.cancelled_at).toLocaleString()
              : "n/a"}
          </OverviewField>
          <OverviewField label="Cancel reason">
            <div className="break-all font-mono text-xs">{runDetail.cancel_reason || "n/a"}</div>
          </OverviewField>
        </div>
      </details>

      {metadata && (
        <details className="rounded-lg border border-border bg-card/50 p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Raw metadata
          </summary>
          <pre className="mt-4 overflow-auto rounded-lg border border-border bg-background/80 p-3 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">
            {metadata}
          </pre>
        </details>
      )}
    </>
  )
}

function RunEditDiffsSection({ runDetail }: { runDetail: FlowRunDetail }) {
  const edits = collectRunEditDiffs(runDetail)

  if (edits.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">Edits</div>
        <div className="text-xs text-muted-foreground">
          {edits.length} commit diff{edits.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="space-y-3">
        {edits.map((edit) => {
          const shortSha = edit.commitSha ? edit.commitSha.slice(0, 7) : null
          const commitLabel = shortSha ?? "Open commit"

          return (
            <div key={edit.id} className="rounded-lg border border-border bg-card/50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-accent-green/20 bg-accent-green/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-accent-green">
                      Edit applied
                    </span>
                    <span className="text-xs text-muted-foreground">{edit.sourceLabel}</span>
                  </div>
                  {edit.path && (
                    <div className="break-words font-mono text-xs text-foreground">
                      {edit.path}
                    </div>
                  )}
                  {edit.branch && (
                    <div className="text-xs text-muted-foreground">Branch: {edit.branch}</div>
                  )}
                </div>
                {edit.commitUrl ? (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <a href={edit.commitUrl} target="_blank" rel="noreferrer">
                      {commitLabel}
                    </a>
                  </Button>
                ) : shortSha ? (
                  <span className="font-mono text-xs text-muted-foreground">{shortSha}</span>
                ) : null}
              </div>
              {edit.patch && <PatchViewer patch={edit.patch} className="mt-4" />}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RunDetailsSummary({ runDetail }: { runDetail: FlowRunDetail }) {
  const statusLabel = flowRunStatusLabel(runDetail)
  return (
    <section className="space-y-3">
      <div className="text-sm font-medium text-foreground">Summary</div>
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <MetricCard
          label="Status"
          value={statusLabel}
          detail={formatRunSourceType(runDetail.source_type)}
        />
        <MetricCard
          label="Duration"
          value={formatDuration(runDetail.duration_ms)}
          detail={
            runDetail.started_at
              ? `Started ${new Date(runDetail.started_at).toLocaleString()}`
              : "Not started"
          }
        />
        <MetricCard
          label="Attempts"
          value={runDetail.start_attempts}
          detail={runDetail.last_start_source || "unknown source"}
        />
        <MetricCard
          label="Activity"
          value={`${runDetail.dispatch_events.length + runDetail.node_runs.length + runDetail.ai_calls.length}`}
          detail={`${runDetail.dispatch_events.length} dispatch · ${runDetail.node_runs.length} nodes · ${runDetail.ai_calls.length} AI calls`}
        />
      </div>
    </section>
  )
}

function RunWaitsSection({ runDetail }: { runDetail: FlowRunDetail }) {
  const waits = runDetail.waits ?? []
  if (waits.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">Durable waits</div>
        <div className="text-xs text-muted-foreground">
          {getActiveFlowWaits(runDetail).length} active
        </div>
      </div>
      <div className="space-y-3">
        {waits.map((wait) => (
          <div
            key={wait.id}
            className="rounded-lg border border-border bg-card/50 p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${
                  wait.status === "waiting"
                    ? "border-amber-400/20 bg-amber-400/[0.06] text-amber-400"
                    : wait.status === "resumed"
                      ? "border-accent-green/20 bg-accent-green/[0.06] text-accent-green"
                      : "border-border bg-secondary/50 text-muted-foreground"
                }`}
              >
                {wait.status}
              </span>
              <span className="text-sm text-foreground">
                {flowWaitDescription(wait)}
              </span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Started {new Date(wait.created_at).toLocaleString()}
              {wait.expires_at
                ? ` · timeout ${new Date(wait.expires_at).toLocaleString()}`
                : " · no timeout"}
            </div>
            {wait.status === "waiting" &&
              wait.wait_config.kind === "manual_approval" && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Resolve this gate from Pending approvals in Observability.
                </div>
              )}
          </div>
        ))}
      </div>
    </section>
  )
}

function RunReviewFindingsSection({
  runDetail,
  reviewFindingIssueActionId,
  onCreateReviewFindingIssue,
}: {
  runDetail: FlowRunDetail
  reviewFindingIssueActionId: string | null
  onCreateReviewFindingIssue: (findingId: string) => void | Promise<void>
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">Review findings</div>
        <div className="text-xs text-muted-foreground">
          {runDetail.review_findings.length} finding
          {runDetail.review_findings.length === 1 ? "" : "s"}
        </div>
      </div>
      {runDetail.review_findings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No structured review findings were captured for this run.
        </div>
      ) : (
        <div className="space-y-3">
          {runDetail.review_findings.map((finding) => {
            const location = formatReviewFindingLocation(finding)
            const issuePending = reviewFindingIssueActionId === finding.id
            const canCreateIssue = finding.status !== "issue_created"
            const issueHref = resolveReviewFindingIssueLink(finding.issue_url)

            return (
              <div key={finding.id} className="rounded-lg border border-border bg-card/50 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${reviewFindingSeverityTone(finding.severity)}`}
                      >
                        {reviewFindingSeverityLabel(finding.severity)}
                      </span>
                      <span className="rounded border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {finding.status.replaceAll("_", " ")}
                      </span>
                      {location && <span className="text-xs text-muted-foreground">{location}</span>}
                      {finding.issue_number != null && (
                        <span className="text-xs text-muted-foreground">Issue #{finding.issue_number}</span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">{finding.title}</div>
                      <div className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                        {finding.body}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {issueHref ? (
                      <Button type="button" variant="outline" size="sm" asChild>
                        <a href={issueHref} target="_blank" rel="noreferrer">
                          Open issue
                        </a>
                      </Button>
                    ) : canCreateIssue ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={issuePending || reviewFindingIssueActionId !== null}
                        onClick={() => void onCreateReviewFindingIssue(finding.id)}
                      >
                        {issuePending && <Spinner className="size-3.5" />}
                        Create issue
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Issue status synced</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function RunDispatchTimelineSection({ runDetail }: { runDetail: FlowRunDetail }) {
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

function RunExecutionSection({ runDetail }: { runDetail: FlowRunDetail }) {
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

function RunAiCallsSection({ runDetail }: { runDetail: FlowRunDetail }) {
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
                        // Key uses tool name as the stable identifier within this call's list.
                        // The index suffix guards against duplicate tool names in a single call.
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

export function FlowRunDetailsDialog({
  open,
  runDetail,
  runSummary,
  loading,
  error,
  activeRunActions,
  reviewFindingIssueActionId,
  onOpenChange,
  onRunAction,
  onCreateReviewFindingIssue,
}: FlowRunDetailsDialogProps) {
  const actionRun = runDetail ?? runSummary

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flows-theme flex h-[92vh] max-h-[960px] !w-[96vw] !max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:!max-w-[1360px]"
        showCloseButton
      >
        <RunDetailsHeader runDetail={runDetail} runSummary={runSummary} />

        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading run details...</div>
        ) : error ? (
          <div className="p-6 text-sm text-accent-red">
            {error instanceof Error ? error.message : "Failed to load run details"}
          </div>
        ) : runDetail ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
            <ScrollArea className="min-h-0 border-b border-border bg-card/30 lg:border-r lg:border-b-0">
              <aside className="space-y-6 px-6 py-5">
                <section className="space-y-3">
                  <div className="text-sm font-medium text-foreground">Actions</div>
                  {actionRun && getRunActionDescriptors(actionRun).length > 0 ? (
                    <RunActionButtons
                      run={actionRun}
                      activeRunActions={activeRunActions}
                      onRunAction={onRunAction}
                      size="default"
                    />
                  ) : actionRun ? (
                    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      {getRunActionEmptyState(actionRun)}
                    </div>
                  ) : null}
                </section>

                <RunDetailsOverview runDetail={runDetail} />
              </aside>
            </ScrollArea>

            <ScrollArea className="min-h-0">
              <div className="space-y-6 px-6 py-5">
                <RunDetailsSummary runDetail={runDetail} />
                <RunWaitsSection runDetail={runDetail} />
                <RunEditDiffsSection runDetail={runDetail} />
                <RunReviewFindingsSection
                  runDetail={runDetail}
                  reviewFindingIssueActionId={reviewFindingIssueActionId}
                  onCreateReviewFindingIssue={onCreateReviewFindingIssue}
                />
                <RunDispatchTimelineSection runDetail={runDetail} />
                <RunExecutionSection runDetail={runDetail} />
                <RunAiCallsSection runDetail={runDetail} />
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="p-6 text-sm text-muted-foreground">Run details unavailable.</div>
        )}
      </DialogContent>
    </Dialog>
  )
}
