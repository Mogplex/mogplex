"use client"

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import type { JobsFilters } from "@/hooks/use-observability"
import type { ObservabilityJob } from "@/lib/types"
import { presentWork, workDuration } from "@/lib/observability/work-presentation"
import { AutomationCostCell } from "./automation-presentation-cells"
import { StatusBadge } from "./badges"
import { timeAgo } from "./formatters"
import { PaginationControls } from "./pagination-controls"
import { RunsControls } from "./runs-controls"
import { RunInspector } from "./run-inspector"
import type { WorkAction } from "./work-actions"
import { useEffect, useRef } from "react"

export function RunsSection({ jobs, jobsLoading, jobsTotal, jobsPages, jobFilters, isCurrentPendingView, jobActionId, jobActionError, loadError, onRefresh, onUpdateJobFilter, onRunJobAction }: {
  jobs: ObservabilityJob[]; jobsLoading: boolean; jobsTotal: number; jobsPages: number;
  jobFilters: JobsFilters; isCurrentPendingView: boolean; jobActionId: string | null;
  jobActionError: string | null; loadError?: unknown; onRefresh?: () => void;
  onUpdateJobFilter: (key: keyof JobsFilters, value: JobsFilters[keyof JobsFilters]) => void;
  onRunJobAction: (jobId: string, action: WorkAction) => Promise<void>;
}) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const { scope } = useParams<{ scope: string }>()
  const selected = params.get("run_id")
  const source = params.get("run_kind") ?? "flow"
  const previousSelected = useRef(selected)
  useEffect(() => {
    if (!selected && previousSelected.current) document.getElementById(`work-${previousSelected.current}`)?.focus()
    previousSelected.current = selected
  }, [selected])
  const select = (job?: ObservabilityJob) => {
    const next = new URLSearchParams(params)
    if (job) { next.set("run_id", job.id); next.set("run_kind", job.source_kind) }
    else { next.delete("run_id"); next.delete("run_kind") }
    router.push(`${pathname}?${next}`, { scroll: false })
  }
  return <section id="runs" tabIndex={-1} className="min-w-0 scroll-mt-4 space-y-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
    <RunsControls jobsLoading={jobsLoading} jobFilters={jobFilters} isCurrentPendingView={isCurrentPendingView} onUpdateJobFilter={onUpdateJobFilter} />
    {Boolean(loadError) && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm"><p>Runs could not be refreshed. Previously loaded results may be out of date.</p><Button variant="outline" onClick={onRefresh}>Try again</Button></div>}
    <div className={selected ? "grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]" : "min-w-0"}>
      <div className={selected ? "hidden min-w-0 xl:block" : "min-w-0"}>
        <div className="overflow-hidden rounded-md border border-border">
          {!selected && <div aria-hidden="true" className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_5rem] gap-4 border-b border-border bg-muted px-4 py-3 text-xs font-medium text-muted-foreground lg:grid"><span>Work</span><span>Repository</span><span>State</span><span>Started / duration</span><span>Cost</span><span>Action</span></div>}
          {jobsLoading && jobs.length === 0 ? <div role="status" aria-label="Loading runs" className="space-y-4 p-4">{[0, 1, 2].map((row) => <div key={row} className="h-12 animate-pulse rounded bg-muted" />)}</div>
            : jobs.length === 0 ? <div className="space-y-2 p-6"><h3 className="font-medium">{loadError ? "Run history unavailable" : "No runs match this view"}</h3><p className="text-sm text-muted-foreground">{loadError ? "Try refreshing when your connection is restored." : "Change the date range or filters. Runs appear here after you start work from a workspace, Slack, or an automation."}</p></div>
            : <ul className="divide-y divide-border">{jobs.map((job) => {
              const work = presentWork(job, scope)
              return <li key={job.id} className={`grid gap-3 p-4 hover:bg-muted ${selected === job.id ? "bg-muted" : "bg-card"} ${selected ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_5rem] lg:items-center lg:gap-4"}`}>
                <div className="min-w-0"><button id={`work-${job.id}`} type="button" aria-current={selected === job.id ? "true" : undefined} className="line-clamp-2 min-h-11 text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => select(job)}>{work.title}</button><p className="truncate text-xs text-muted-foreground">{job.agent.name} · {job.source_type.replaceAll("_", " ")}</p></div>
                {!selected && <p className="break-words text-sm text-muted-foreground">{job.repo.full_name ?? "Repository unavailable"}</p>}
                <div><StatusBadge status={job.status} label={work.label} /></div>
                <div className="text-xs text-muted-foreground"><time dateTime={job.started_at ?? job.created_at} title={new Date(job.started_at ?? job.created_at).toLocaleString()}>{timeAgo(job.started_at ?? job.created_at)}</time><p className="tabular-nums">{workDuration(job)}</p>{selected && <p>{job.repo.full_name}</p>}</div>
                <div className="text-sm"><AutomationCostCell status={job.status} costUsd={job.cost_usd} /></div>
                {!selected && <Button variant="outline" size="sm" aria-label={`Inspect ${work.title}`} onClick={() => select(job)}>Inspect</Button>}
              </li>
            })}</ul>}
        </div>
        <PaginationControls page={jobFilters.page} totalPages={jobsPages} total={jobsTotal} limit={jobFilters.limit} onChange={(page) => onUpdateJobFilter("page", page)} />
      </div>
      {selected && <RunInspector key={`${source}:${selected}`} id={selected} source={source} busy={jobActionId !== null} error={jobActionError} onAction={onRunJobAction} onClose={() => select()} />}
    </div>
  </section>
}
