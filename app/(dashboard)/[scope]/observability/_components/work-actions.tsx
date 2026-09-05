"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import type { ObservabilityJob } from "@/lib/types"
import { presentWork } from "@/lib/observability/work-presentation"

export type WorkAction = "repair" | "requeue" | "cancel"
const explanations: Record<WorkAction, string> = {
  repair: "Ask Mogplex to reconcile this run with its runtime and recover it where supported. This is not a promise of a saved checkpoint.",
  requeue: "Start a new run from the original request. It may repeat work and incur additional cost; it does not resume a saved checkpoint.",
  cancel: "Request that this run stop. Cancellation may take time while the current operation finishes.",
}
const labels: Record<WorkAction, string> = { repair: "Repair run", requeue: "Retry as new run", cancel: "Cancel run" }

export function WorkActions({ job, scope, busy, onAction }: { job: ObservabilityJob; scope: string; busy: boolean; onAction: (id: string, action: WorkAction) => Promise<void> }) {
  const work = presentWork(job, scope)
  const [confirm, setConfirm] = useState<WorkAction | null>(null)
  const actions: WorkAction[] = []
  if (job.repairable) actions.push("repair")
  if (job.requeueable) actions.push("requeue")
  if (job.cancelable) actions.push("cancel")
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      {work.workspaceHref && <Button asChild size="sm"><Link href={work.workspaceHref}>View work</Link></Button>}
      {work.github && <Button asChild variant={work.workspaceHref ? "outline" : "default"} size="sm"><a href={work.github.href} target="_blank" rel="noopener noreferrer">{work.github.kind === "pr" ? "Open PR" : "Open in GitHub"}</a></Button>}
      {work.callHref && <Button asChild variant="outline" size="sm"><Link href={work.callHref}>View AI activity</Link></Button>}
      {actions.map((action) => <Button key={action} size="sm" variant="outline" disabled={busy} onClick={() => setConfirm(action)}>{labels[action]}</Button>)}
    </div>
    {confirm && <div className="space-y-3 rounded-md border border-border bg-muted p-3" role="group" aria-label={labels[confirm]}>
      <p className="text-sm leading-6">{explanations[confirm]}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={async () => { await onAction(job.id, confirm); setConfirm(null) }}>{busy ? "Sending request…" : `Confirm ${labels[confirm].toLowerCase()}`}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm(null)}>Keep current run</Button>
      </div>
    </div>}
  </div>
}
