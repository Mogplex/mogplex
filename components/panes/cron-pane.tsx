"use client"
import { useMemo, useState } from "react"
import useSWR from "swr"
import type { Assignment } from "@/lib/types"
import { toast } from "@/hooks/use-toast"
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh"

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`API error: ${r.status}`)
  return r.json()
}

function parseNextRun(cronExpr: string | null): string {
  if (!cronExpr) return "—"
  try {
    const parts = cronExpr.trim().split(/\s+/)
    if (parts.length < 5) return cronExpr

    const now = new Date()
    const [min, hour] = parts
    if (min === "*" && hour === "*") return "every minute"
    if (min !== "*" && hour === "*") return `every hour at :${min.padStart(2, "0")}`
    if (min !== "*" && hour !== "*") {
      const next = new Date(now)
      next.setHours(parseInt(hour), parseInt(min), 0, 0)
      if (next <= now) next.setDate(next.getDate() + 1)
      const diff = next.getTime() - now.getTime()
      const hrs = Math.floor(diff / 3600000)
      const mins = Math.floor((diff % 3600000) / 60000)
      return `in ${hrs}h ${mins}m`
    }
    return cronExpr
  } catch {
    return cronExpr || "—"
  }
}

const TYPE_LABELS: Record<string, string> = {
  cron: "cron",
  cron_refactor: "refactor",
  pr_review: "pr review",
  push_review: "push review",
  issue_triage: "issue triage",
  ci_failure: "ci failure",
}

export function CronPane() {
  const { data: assignments, mutate, isLoading } = useSWR<Assignment[]>(
    "/api/assignments",
    fetcher
  )
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const realtimeSpecs = useMemo(() => [{ table: "assignments" }], [])
  useRealtimeRouteRefresh({
    channelName: "cron-pane",
    specs: realtimeSpecs,
    onInvalidate: mutate,
  })

  const cronAssignments = (assignments || []).filter(
    (a) => a.type === "cron" || a.type === "cron_refactor"
  )

  const deleteAssignment = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/assignments?id=${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      await mutate()
      toast({ title: "Cron deleted" })
    } catch {
      toast({ title: "Error", description: "Failed to delete cron", variant: "destructive" })
    } finally {
      setDeletingId(null)
    }
  }

  const toggleEnabled = async (assignment: Assignment) => {
    setTogglingId(assignment.id)
    try {
      await fetch("/api/assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assignment.id, enabled: !assignment.enabled }),
      })
      await mutate()
    } catch {
      // SWR will refetch
    } finally {
      setTogglingId(null)
    }
  }

  if (isLoading) {
    return <div className="flex-1 p-3 text-sm text-muted-foreground">Loading cron jobs...</div>
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-dim">
        <span className="text-[11px] text-muted-foreground">
          {cronAssignments.length} cron{cronAssignments.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        {cronAssignments.length === 0 && (
          <div className="flex items-center justify-center h-full p-4 text-center text-sm text-muted-foreground">
            No cron jobs. Schedule work from the automations editor — pick the
            schedule start event.
          </div>
        )}
        {cronAssignments.map((assignment) => (
          <div
            key={assignment.id}
            className="flex items-center gap-2 px-3 py-2 border-b border-border-dim"
          >
            <button
              onClick={() => void toggleEnabled(assignment)}
              disabled={togglingId === assignment.id}
              className={`w-8 h-4 rounded-full relative transition-colors ${
                assignment.enabled ? "bg-accent-green" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-primary-foreground transition-transform ${
                  assignment.enabled ? "left-[18px]" : "left-0.5"
                }`}
              />
            </button>
            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
              {assignment.cron_schedule || "—"}
            </span>
            <span className="text-sm text-foreground flex-1 truncate">
              {TYPE_LABELS[assignment.type] || assignment.type}
            </span>
            <span className="text-[11px] text-muted-foreground shrink-0">
              {parseNextRun(assignment.cron_schedule)}
            </span>
            <button
              onClick={() => void deleteAssignment(assignment.id)}
              disabled={deletingId === assignment.id}
              className="text-muted-foreground hover:text-accent-red disabled:opacity-50 text-sm shrink-0"
              title="Delete"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
