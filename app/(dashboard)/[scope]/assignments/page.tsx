"use client"
import { useState } from "react"
import { useAssignments } from "@/hooks/use-assignments"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export default function AssignmentsPage() {
  const { assignments, repos, agents, isLoading, error, mutate } = useAssignments()
  const [jobActionId, setJobActionId] = useState<string | null>(null)

  const deleteAssignment = async (id: string) => {
    const res = await fetch(`/api/assignments?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    if (res.ok) {
      await mutate()
    }
  }

  const runJobAction = async (jobRunId: string, action: "repair" | "requeue" | "cancel") => {
    setJobActionId(jobRunId)
    try {
      const res = await fetch(`/api/observability/jobs/${jobRunId}/${action}`, { method: "POST" })
      if (res.ok) {
        await mutate()
      }
    } finally {
      setJobActionId(null)
    }
  }

  const getName = (id: string, list: { id: string; name?: string; full_name?: string }[]) => list.find(x => x.id === id)?.name || list.find(x => x.id === id)?.full_name || id

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-1">
        <h1 className="ui-page-title">Assignments</h1>
        <p className="ui-page-subtitle">
          Read-only. Assignments ran an agent&apos;s own model with no way for the
          automation to override it; automations own the model now. Existing rows
          can be disabled and deleted here — build new work in the automations
          editor.
        </p>
      </div>
      {error && (
        <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Failed to load assignments
        </div>
      )}
      <div className="space-y-1">
        {isLoading && <div className="ui-meta">Loading assignments...</div>}
        {assignments.map(a => (
          <div key={a.id} className="px-3 py-3 bg-card border border-border text-sm rounded-sm flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div>
                {getName(a.repo_id, repos)} → {getName(a.agent_id, agents)} <span className="text-muted-foreground ml-1 text-[11px]">{a.type || "—"}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  Last run: {a.last_run_status || "never"}
                  {a.last_run_started_at ? ` · ${new Date(a.last_run_started_at).toLocaleString()}` : ""}
                </span>
                {typeof a.failed_24h === "number" && a.failed_24h > 0 && (
                  <Badge variant="outline" className="text-[11px] text-accent-red border-accent-red/20 bg-accent-red/5">
                    {a.failed_24h} failed / 24h
                  </Badge>
                )}
                {typeof a.running_count === "number" && a.running_count > 0 && (
                  <Badge variant="outline" className="text-[11px] text-accent-blue border-accent-blue/20 bg-accent-blue/5">
                    {a.running_count} running
                  </Badge>
                )}
                {typeof a.pending_count === "number" && a.pending_count > 0 && (
                  <Badge variant="outline" className="text-[11px] text-accent-amber border-accent-amber/20 bg-accent-amber/5">
                    {a.pending_count} pending
                  </Badge>
                )}
                {typeof a.suppressed_24h === "number" && a.suppressed_24h > 0 && (
                  <Badge variant="outline" className="text-[11px] text-accent-red border-accent-red/20 bg-accent-red/5">
                    {a.suppressed_24h} suppressed / 24h
                  </Badge>
                )}
                {typeof a.deferred_24h === "number" && a.deferred_24h > 0 && (
                  <Badge variant="outline" className="text-[11px] text-accent-amber border-accent-amber/20 bg-accent-amber/5">
                    {a.deferred_24h} deferred / 24h
                  </Badge>
                )}
                {a.last_run_error && (
                  <span className="truncate text-accent-red" title={a.last_run_error}>
                    {a.last_run_error}
                  </span>
                )}
                {a.last_pressure_reason && (
                  <span className="truncate text-accent-amber" title={a.last_pressure_reason}>
                    Pressure: {a.last_pressure_reason}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {a.last_job_run_id && a.last_run_repairable && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={jobActionId === a.last_job_run_id}
                  onClick={() => void runJobAction(a.last_job_run_id!, "repair")}
                >
                  Repair
                </Button>
              )}
              {a.last_job_run_id && a.last_run_cancelable && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={jobActionId === a.last_job_run_id}
                  onClick={() => void runJobAction(a.last_job_run_id!, "cancel")}
                >
                  Cancel
                </Button>
              )}
              {a.last_job_run_id && a.last_run_requeueable && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={jobActionId === a.last_job_run_id}
                  onClick={() => void runJobAction(a.last_job_run_id!, "requeue")}
                >
                  Requeue
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button aria-label="Assignment actions" className="px-1 py-0.5 text-muted-foreground hover:text-foreground rounded hover:bg-secondary text-sm">···</button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem variant="destructive" onSelect={() => void deleteAssignment(a.id)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
