"use client"

import { useEffect, useRef } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useObservabilityRunDetail } from "@/hooks/use-observability-run-detail"
import { presentWork, recordedAgentReport, workDuration } from "@/lib/observability/work-presentation"
import { StatusBadge } from "./badges"
import { AutomationCostCell } from "./automation-presentation-cells"
import { JobExpandedRow } from "./job-expanded-row"
import { WorkActions, type WorkAction } from "./work-actions"
import { RunTimeline, RunUsage } from "./run-inspector-sections"

export function RunInspector({ id, source, busy, error: actionError, onAction, onClose }: {
  id: string; source: string; busy: boolean; error: string | null;
  onAction: (id: string, action: WorkAction) => Promise<void>; onClose: () => void;
}) {
  const { scope } = useParams<{ scope: string }>()
  const { data, error, isLoading, isValidating, refresh, connection } = useObservabilityRunDetail(id, source)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [id, isLoading])
  const run = error ? undefined : data?.run
  const work = run ? presentWork(run, scope) : null
  const report = run ? recordedAgentReport(run.ai_calls) : null
  const disconnectedMessage = run && ["success", "failed", "cancelled"].includes(run.status)
    ? "Updates disconnected. Showing the last saved result."
    : "Updates disconnected. Execution may still be running."
  return <section aria-label="Run details" className="min-w-0 rounded-md border border-border bg-card xl:sticky xl:top-4 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
    <div className="flex items-center justify-between gap-3 border-b border-border p-4">
      <h2 ref={heading} tabIndex={-1} className="text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Run details</h2>
      <Button variant="outline" size="sm" onClick={onClose}>Back to runs</Button>
    </div>
    {isLoading && <div className="space-y-4 p-5" role="status" aria-label="Loading run details"><div className="h-6 w-3/4 animate-pulse rounded bg-muted" /><div className="h-20 animate-pulse rounded bg-muted" /></div>}
    {error && <div className="space-y-3 p-5" role="alert"><p>{error instanceof Error ? error.message : "Run details could not be loaded."}</p><Button variant="outline" onClick={() => void refresh()}>Try again</Button></div>}
    {data && run && work && <>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={run.status} label={work.label} /><span className="text-xs text-muted-foreground">{run.repo.full_name ?? "Repository unavailable"}</span></div>
        <div className="space-y-2"><h3 className="break-words text-xl font-semibold leading-7">{work.title}</h3>{work.subtitle && work.subtitle !== work.title && <p className="text-sm text-muted-foreground">{work.subtitle}</p>}<p className="max-w-prose text-sm leading-6">{work.summary}</p></div>
        <WorkActions job={run} scope={scope} busy={busy || Boolean(error) || isValidating} onAction={async (runId, action) => { await onAction(runId, action); await refresh() }} />
        {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
        <dl className="grid grid-cols-3 gap-3 border-y border-border py-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Cost</dt><dd><AutomationCostCell status={run.status} costUsd={run.cost_usd} /></dd></div>
          <div><dt className="text-xs text-muted-foreground">{run.completed_at ? "Duration" : "Elapsed at update"}</dt><dd className="tabular-nums">{workDuration(run, Date.parse(data.receivedAt))}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Attempts</dt><dd className="tabular-nums">{run.start_attempts}</dd></div>
        </dl>
        <div className="space-y-1 text-xs text-muted-foreground" role="status">
          <p>{connection === "disconnected" ? disconnectedMessage : connection === "connecting" ? "Connecting to updates…" : "Connected to updates"}{isValidating ? " · Refreshing…" : ""}</p>
          <p>Last refreshed <time dateTime={data.receivedAt}>{new Date(data.receivedAt).toLocaleTimeString()}</time></p>
        </div>
      </div>
      <Tabs defaultValue="summary" className="gap-0">
        <TabsList className="mx-5 flex h-auto flex-wrap justify-start"><TabsTrigger value="summary">Summary</TabsTrigger><TabsTrigger value="timeline">Timeline</TabsTrigger><TabsTrigger value="usage">AI usage</TabsTrigger><TabsTrigger value="diagnostics">Diagnostics</TabsTrigger></TabsList>
        <TabsContent value="summary" className="space-y-4 p-5">
          {report && <section className="space-y-2"><h4 className="text-sm font-medium">Agent report</h4><p className="text-xs text-muted-foreground">The agent’s account of its work, not independent verification.</p><p className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm leading-6">{report}</p></section>}
          {work.branch && <p className="text-sm">Branch <code className="break-all text-xs">{work.branch}</code></p>}
          <RunTimeline run={run} latestOnly />
          {run.review_findings.length > 0 && <section className="space-y-3"><h4 className="font-medium">Review findings ({run.review_findings.length})</h4>{run.review_findings.map((finding) => <div key={finding.id} className="space-y-1 border-t border-border pt-3"><p className="text-sm font-medium">{finding.title}</p><p className="text-sm leading-6">{finding.body}</p>{finding.path && <code className="break-all text-xs text-muted-foreground">{finding.path}{finding.line ? `:${finding.line}` : ""}</code>}</div>)}</section>}
        </TabsContent>
        <TabsContent value="timeline" className="p-5"><RunTimeline run={run} /></TabsContent>
        <TabsContent value="usage" className="p-5"><RunUsage run={run} /></TabsContent>
        <TabsContent value="diagnostics"><JobExpandedRow job={run} /></TabsContent>
      </Tabs>
    </>}
  </section>
}
