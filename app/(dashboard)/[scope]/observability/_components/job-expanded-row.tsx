"use client"

import { StructuredValueViewer } from "@/components/diffs/structured-value-viewer"
import { getJobRunRuntimeProvider, getJobRunRuntimeRunId } from "@/lib/job-run-runtime"
import {
  formatAutomationTimeoutBudgetLabel,
  getAutomationCostPrimaryLabel,
  getAutomationCostSecondaryLabel,
  getAutomationCostState,
  getAutomationStatusPresentation,
  readAutomationFailureClass,
} from "@/lib/observability/automation-run-presentation"
import type { ObservabilityJob } from "@/lib/types"
import {
  formatDispatchOutcome,
  formatDispatchReason,
  getJobAutomationSummary,
} from "./formatters"
import { GithubEventLinkPanel } from "./github-event-link-panel"

export function JobExpandedRow({ job }: { job: ObservabilityJob }) {
  const runtimeProvider = getJobRunRuntimeProvider(job)
  const runtimeRunId = getJobRunRuntimeRunId(job)
  const statusPresentation = getAutomationStatusPresentation({
    status: job.status,
    metadata: job.latest_dispatch_event?.metadata,
    error: job.error,
  })
  const timeoutBudget = formatAutomationTimeoutBudgetLabel(
    statusPresentation.timeoutBudgetMs
  )
  const costState = getAutomationCostState({
    status: job.status,
    costUsd: job.cost_usd,
  })
  const costSecondaryLabel = getAutomationCostSecondaryLabel(costState)
  const costPrimaryLabel = getAutomationCostPrimaryLabel({
    costState,
    costUsd: job.cost_usd,
  })
  const failureClass = readAutomationFailureClass(job.latest_dispatch_event?.metadata)

  return (
    <div className="p-4 space-y-3 text-sm">
      <GithubEventLinkPanel
        sourceType={job.source_type}
        repoFullName={job.repo.full_name}
        metadata={job.metadata}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <div className="ui-label mb-0.5">Runtime Run</div>
          <div className="font-mono text-foreground break-all">{runtimeRunId || "—"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Runtime Provider</div>
          <div className="text-foreground">{runtimeProvider || "—"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Last Start Source</div>
          <div className="text-foreground">{job.last_start_source || "—"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Retry Lineage</div>
          <div className="font-mono text-foreground break-all">{job.retry_of_job_run_id || "—"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <div className="ui-label mb-0.5">Run Result</div>
          <div className="text-foreground">{statusPresentation.label}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Run Cost</div>
          <div className="text-foreground">{costPrimaryLabel}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Cost State</div>
          <div className="text-foreground">
            {costState === "known"
              ? "recorded"
              : costSecondaryLabel ?? costState}
          </div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Timeout Budget</div>
          <div className="text-foreground">{timeoutBudget || "—"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <div className="ui-label mb-0.5">Latest Automation Outcome</div>
          <div className="text-foreground">{job.latest_dispatch_event ? getJobAutomationSummary(job) : "—"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Dispatch Outcome</div>
          <div className="text-foreground">{job.latest_dispatch_event ? formatDispatchOutcome(job.latest_dispatch_event.outcome) : "—"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Dispatch Reason</div>
          <div className="text-foreground">{job.latest_dispatch_event ? formatDispatchReason(job.latest_dispatch_event.reason, job.latest_dispatch_event.metadata) : "—"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Failure Class</div>
          <div className="text-foreground">{failureClass || "—"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Dispatch Event</div>
          <div className="text-foreground">{job.latest_dispatch_event ? `${job.latest_dispatch_event.event_kind} · ${new Date(job.latest_dispatch_event.created_at).toLocaleString()}` : "—"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <div className="ui-label mb-0.5">Cancellation Requested</div>
          <div className="text-foreground">{job.cancel_requested_at ? new Date(job.cancel_requested_at).toLocaleString() : "—"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Cancelled At</div>
          <div className="text-foreground">{job.cancelled_at ? new Date(job.cancelled_at).toLocaleString() : "—"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Cancel Reason</div>
          <div className="font-mono text-foreground break-all">{job.cancel_reason || "—"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Cancel Error</div>
          <div className="font-mono text-foreground break-all">{job.cancel_error || "—"}</div>
        </div>
      </div>

      {job.last_start_error && (
        <div>
          <div className="ui-label mb-1">Last Start Error</div>
          <div className="rounded bg-accent-red/5 px-2 py-1 font-mono text-accent-red">
            {job.last_start_error}
          </div>
        </div>
      )}

      {job.error && (
        <div>
          <div className="ui-label mb-1">Run Error</div>
          <div className="rounded bg-accent-red/5 px-2 py-1 font-mono text-accent-red">
            {job.error}
          </div>
        </div>
      )}

      <div>
        <div className="ui-label mb-1">Metadata</div>
        <StructuredValueViewer value={job.metadata || {}} className="my-0" stringLanguage="language-json" />
      </div>
    </div>
  )
}
