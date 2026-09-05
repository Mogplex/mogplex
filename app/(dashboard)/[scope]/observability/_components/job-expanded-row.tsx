"use client"

import { StructuredValueViewer } from "@/components/diffs/structured-value-viewer"
import { getJobRunRuntimeProvider, getJobRunRuntimeRunId } from "@/lib/job-run-runtime"
import type { ObservabilityJob } from "@/lib/types"
import { formatDispatchOutcome, formatDispatchReason } from "./formatters"

export function JobExpandedRow({ job }: { job: ObservabilityJob }) {
  const fields = [
    ["Run ID", job.id], ["Runtime run", getJobRunRuntimeRunId(job)],
    ["Runtime provider", getJobRunRuntimeProvider(job)], ["Last start source", job.last_start_source],
    ["Retry of run", job.retry_of_job_run_id],
    ["Dispatch outcome", job.latest_dispatch_event ? formatDispatchOutcome(job.latest_dispatch_event.outcome) : null],
    ["Dispatch reason", job.latest_dispatch_event ? formatDispatchReason(job.latest_dispatch_event.reason, job.latest_dispatch_event.metadata) : null],
    ["Cancellation requested", job.cancel_requested_at], ["Cancelled at", job.cancelled_at],
    ["Cancel reason", job.cancel_reason], ["Cancel error", job.cancel_error],
    ["Last start error", job.last_start_error], ["Run error", job.error],
  ].filter((field) => field[1])
  return <div className="space-y-5 p-5 text-sm">
    <p className="text-muted-foreground">Technical context for troubleshooting. Only recorded fields are shown.</p>
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt className="mb-1 text-xs text-muted-foreground">{label}</dt><dd className="break-all text-sm">{value}</dd></div>)}</dl>
    <details><summary className="cursor-pointer py-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Sanitized metadata</summary><StructuredValueViewer value={job.metadata ?? {}} className="my-0 max-h-96 overflow-auto" stringLanguage="language-json" /></details>
  </div>
}
