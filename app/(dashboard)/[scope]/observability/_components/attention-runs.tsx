"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useObservabilityJobs } from "@/hooks/use-observability"
import { Button } from "@/components/ui/button"
import { presentWork } from "@/lib/observability/work-presentation"

export function AttentionRuns({ status = "pending" }: { status?: "pending" | "awaiting_input" }) {
  const { scope } = useParams<{ scope: string }>()
  const { data, error, isLoading, refresh } = useObservabilityJobs({
    page: 1, limit: 25, sort: "created_at", order: "asc", status,
  })
  const needsInput = status === "awaiting_input"
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{needsInput ? "Agent requests" : "Waiting to start"}</h2>
      <p className="text-sm text-muted-foreground">
        {needsInput ? "Agent runs waiting for your input across all dates." : "Current pending work across all dates. Waiting does not always mean something is wrong."}
      </p>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          Waiting work could not be loaded.
          <Button variant="outline" onClick={() => void refresh()}>Try again</Button>
        </div>
      ) : isLoading ? (
        <p role="status" className="text-sm">Loading waiting work…</p>
      ) : !data?.jobs.length ? (
        <p className="text-sm text-muted-foreground">{needsInput ? "No agent runs are waiting for input." : "No runs are waiting to start."}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {data.jobs.map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{presentWork(job, scope).title}</p>
                <p className="text-xs text-muted-foreground">{job.repo.full_name} · {needsInput ? "Needs your input" : job.repairable ? "Recovery available" : "Waiting to start"}</p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/${scope}/observability?view=runs&run_id=${job.id}&run_kind=${job.source_kind}`}>Inspect run</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.jobs.length && (
        <Link className="text-sm underline" href={`/${scope}/observability?view=runs&run_status=${status}`}>
          View all {data.total} waiting runs
        </Link>
      )}
    </section>
  )
}
