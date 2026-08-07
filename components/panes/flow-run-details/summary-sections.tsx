"use client"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PatchViewer } from "@/components/diffs/patch-viewer"
import {
  collectRunEditDiffs,
  flowRunStatusLabel,
  flowWaitDescription,
  formatDuration,
  formatReviewFindingLocation,
  formatRunSourceType,
  getActiveFlowWaits,
  resolveReviewFindingIssueLink,
  reviewFindingSeverityLabel,
  reviewFindingSeverityTone,
} from "@/lib/flows/run-presentation"
import type { FlowRunDetail } from "@/lib/types"
import { MetricCard } from "./primitives"

export function RunDetailsSummary({ runDetail }: { runDetail: FlowRunDetail }) {
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

export function RunWaitsSection({ runDetail }: { runDetail: FlowRunDetail }) {
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

export function RunEditDiffsSection({ runDetail }: { runDetail: FlowRunDetail }) {
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

export function RunReviewFindingsSection({
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
