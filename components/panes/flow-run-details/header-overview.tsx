"use client"

import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  flowRunStatusLabel,
  formatJson,
  formatRunSourceType,
  getRunCancellationState,
  getRunLatestReason,
  resolveReviewedTargetLink,
  runStatusTone,
} from "@/lib/flows/run-presentation"
import type { FlowRunDetail, FlowRunRecord } from "@/lib/types"
import { OverviewField } from "./primitives"

export function RunDetailsHeader({
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

export function RunDetailsOverview({ runDetail }: { runDetail: FlowRunDetail }) {
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
