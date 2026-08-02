"use client"
import { useLiveInteractiveCalls, useObservabilityStats, useRecentAutomationEvents, useRecentCalls, useRecentJobRuns } from "@/hooks/use-observability"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { formatCostUsd, formatDispatchOutcome, formatDispatchReason, getJobAutomationSummary } from "@/app/(dashboard)/[scope]/observability/_components/formatters"
import type { AiCall, AutomationDispatchEvent, ObservabilityJob } from "@/lib/types"

function formatDuration(ms: number): string {
  if (ms === 0) return "—"
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  return remainMins > 0 ? `${hours}h${remainMins}m` : `${hours}h`
}

function formatTokens(n: number | null): string {
  if (n == null || n === 0) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function ObservabilityPane() {
  const { stats } = useObservabilityStats()
  const { calls, total } = useRecentCalls(30)
  const { jobs, total: totalJobs } = useRecentJobRuns(20)
  const { events, total: totalEvents } = useRecentAutomationEvents(20)
  const { calls: liveCalls, total: totalLiveCalls } = useLiveInteractiveCalls()
  const [tab, setTab] = useState<"overview" | "live" | "jobs" | "pressure" | "calls">("overview")

  const renderBar = (val: number, max: number, color: string) => {
    const pct = max ? Math.min(100, (val / max) * 100) : 0
    return (
      <div className="h-2 bg-secondary rounded-sm flex-1">
        <div className={`h-full rounded-sm ${color}`} style={{ width: `${pct}%` }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-border">
        {(["overview", "live", "jobs", "pressure", "calls"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm ${tab === t ? "bg-muted text-foreground" : "text-muted-foreground"}`}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "overview" && stats?.summary && (
        <div className="flex-1 overflow-auto p-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="border border-border rounded-md p-2">
              <div className="ui-label">Calls</div>
              <div className="text-foreground text-lg">{stats.summary.total_calls ?? 0}</div>
            </div>
            <div className="border border-border rounded-md p-2">
              <div className="ui-label">Runs</div>
              <div className="text-foreground text-lg">{stats.summary.job_runs_total ?? 0}</div>
            </div>
            <div className="border border-border rounded-md p-2">
              <div className="ui-label">Tokens</div>
              <div className="text-foreground text-lg">{formatTokens(stats.summary.total_tokens ?? 0)}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="border border-border rounded-md p-2">
              <div className="ui-label">Suppressed</div>
              <div className={`text-lg ${(stats.summary.suppressed_in_range ?? 0) > 0 ? "text-accent-red" : "text-foreground"}`}>
                {stats.summary.suppressed_in_range ?? 0}
              </div>
            </div>
            <div className="border border-border rounded-md p-2">
              <div className="ui-label">Deferred</div>
              <div className={`text-lg ${(stats.summary.deferred_in_range ?? 0) > 0 ? "text-accent-amber" : "text-foreground"}`}>
                {stats.summary.deferred_in_range ?? 0}
              </div>
            </div>
            <div className="border border-border rounded-md p-2">
              <div className="ui-label">Oldest Pending</div>
              <div className="text-foreground text-lg">{formatDuration(stats.summary.oldest_pending_age_ms ?? 0)}</div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-16 text-muted-foreground">Running</span>
              {renderBar(stats.summary.job_runs_running ?? 0, Math.max(1, stats.summary.job_runs_total ?? 0), "bg-accent-blue")}
              <span className="w-8 text-right">{stats.summary.job_runs_running ?? 0}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-16 text-muted-foreground">Stale</span>
              {renderBar(stats.summary.job_runs_stale_pending ?? 0, Math.max(1, stats.summary.job_runs_pending ?? 0), "bg-accent-amber")}
              <span className="w-8 text-right">{stats.summary.job_runs_stale_pending ?? 0}</span>
            </div>
          </div>
          <div className="ui-meta">
            Run success: {stats.summary.job_runs_success_rate_in_range === null || stats.summary.job_runs_success_rate_in_range === undefined ? "—" : `${stats.summary.job_runs_success_rate_in_range}%`} &middot; Cost: {formatCostUsd(stats.summary.total_cost ?? 0)}
          </div>

          <div className="border-t border-border pt-3 mt-1">
            <div className="ui-kicker mb-2">Sandboxes</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="border border-border rounded-md p-2">
                <div className="ui-label">Active</div>
                <div className={`text-lg ${(stats.summary.sandbox_active ?? 0) > 0 ? "text-accent-green" : "text-foreground"}`}>
                  {stats.summary.sandbox_active ?? 0}
                </div>
              </div>
              <div className="border border-border rounded-md p-2">
                <div className="ui-label">Total</div>
                <div className="text-foreground text-lg">{stats.summary.sandbox_total ?? 0}</div>
              </div>
              <div className="border border-border rounded-md p-2">
                <div className="ui-label">Runtime</div>
                <div className="text-foreground text-lg">{formatDuration(stats.summary.sandbox_time_ms ?? 0)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "live" && (
        <div className="flex-1 overflow-auto">
          {liveCalls.length === 0 && <div className="p-3 text-muted-foreground text-sm">No live interactive runs</div>}
          {liveCalls.map((call: AiCall) => (
            <div key={call.id} className="flex items-center gap-2 px-3 py-2 border-b border-border text-sm">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                call.status === "streaming" ? "bg-accent-blue animate-pulse" : "bg-accent-amber"
              }`} />
              <Badge variant="outline" className="text-[11px] shrink-0">
                {call.type}
              </Badge>
              <span className="truncate flex-1 text-foreground">
                {call.model}
              </span>
              <span className="text-muted-foreground shrink-0">{call.type === "agent" ? "server" : "client"}</span>
              <span className="text-muted-foreground shrink-0 w-10 text-right">{timeAgo(call.started_at)}</span>
            </div>
          ))}
          {totalLiveCalls > liveCalls.length && (
            <div className="p-2 text-center text-[11px] text-muted-foreground">
              +{totalLiveCalls - liveCalls.length} more — open full page
            </div>
          )}
        </div>
      )}

      {tab === "jobs" && (
        <div className="flex-1 overflow-auto">
          {jobs.length === 0 && <div className="p-3 text-muted-foreground text-sm">No runs yet</div>}
          {jobs.map((job: ObservabilityJob) => (
            <div key={job.id} className="flex items-center gap-2 px-3 py-2 border-b border-border text-sm">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                job.status === "success" ? "bg-accent-green"
                : job.status === "failed" ? "bg-accent-red"
                : job.status === "cancelled" ? "bg-muted"
                : job.status === "running" ? "bg-accent-blue animate-pulse"
                : "bg-accent-amber"
              }`} />
              <Badge variant="outline" className="text-[11px] shrink-0 capitalize">
                {job.source_kind.replace("_", " ")}
              </Badge>
              <span className="truncate flex-1 text-foreground">
                {job.repo.full_name || "Unknown repo"}
              </span>
              <span className="text-muted-foreground shrink-0">{getJobAutomationSummary(job) || job.agent.name || "No agent"}</span>
              <span className="text-muted-foreground shrink-0 w-10 text-right">{timeAgo(job.created_at)}</span>
            </div>
          ))}
          {totalJobs > jobs.length && (
            <div className="p-2 text-center text-[11px] text-muted-foreground">
              +{totalJobs - jobs.length} more — open full page
            </div>
          )}
        </div>
      )}

      {tab === "pressure" && (
        <div className="flex-1 overflow-auto">
          {events.length === 0 && <div className="p-3 text-muted-foreground text-sm">No pressure events yet</div>}
          {events.map((event: AutomationDispatchEvent) => (
            <div key={event.id} className="flex items-center gap-2 px-3 py-2 border-b border-border text-sm">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                event.outcome === "suppressed" || event.outcome === "start_failed"
                  ? "bg-accent-red"
                  : event.outcome === "deferred"
                    ? "bg-accent-amber"
                    : "bg-accent-green"
              }`} />
              <Badge variant="outline" className="text-[11px] shrink-0 capitalize">
                {formatDispatchOutcome(event.outcome)}
              </Badge>
              <span className="truncate flex-1 text-foreground">
                {event.repo.full_name || event.source_type}
              </span>
              <span className="text-muted-foreground shrink-0">{formatDispatchReason(event.reason, event.metadata)}</span>
              <span className="text-muted-foreground shrink-0 w-10 text-right">{timeAgo(event.created_at)}</span>
            </div>
          ))}
          {totalEvents > events.length && (
            <div className="p-2 text-center text-[11px] text-muted-foreground">
              +{totalEvents - events.length} more — open full page
            </div>
          )}
        </div>
      )}

      {tab === "calls" && (
        <div className="flex-1 overflow-auto">
          {calls.length === 0 && <div className="p-3 text-muted-foreground text-sm">No calls yet</div>}
          {calls.map((c: AiCall) => (
            <div key={c.id} className="flex items-center gap-2 px-3 py-2 border-b border-border text-sm">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                c.status === "success" ? "bg-accent-green"
                : c.status === "failed" ? "bg-accent-red"
                : c.status === "cancelled" ? "bg-muted"
                : c.status === "streaming" ? "bg-accent-blue animate-pulse"
                : "bg-muted"
              }`} />
              <Badge variant="outline" className="text-[11px] shrink-0">
                {c.type === "chat"
                  ? "Chat"
                  : c.type === "pr_review"
                    ? "PR"
                    : c.type === "cron_refactor" || c.type === "cron"
                      ? "Cron"
                      : c.type === "push_review"
                        ? "Push"
                        : c.type === "issue_triage"
                          ? "Issue"
                          : c.type === "ci_failure"
                            ? "CI"
                            : c.type === "mention"
                              ? "Mention"
                              : c.type === "pr_comment"
                                ? "PR Comment"
                                : c.type === "issue_comment"
                                  ? "Issue Comment"
                                  : c.type}
              </Badge>
              <span className="text-muted-foreground truncate flex-1 font-mono">
                {c.model.includes("/") ? c.model.split("/").pop() : c.model}
              </span>
              <span className="text-muted-foreground shrink-0">{formatTokens(c.total_tokens)}</span>
              <span className="text-muted-foreground shrink-0 w-8 text-right">{timeAgo(c.started_at)}</span>
            </div>
          ))}
          {total > calls.length && (
            <div className="p-2 text-center text-[11px] text-muted-foreground">
              +{total - calls.length} more — open full page
            </div>
          )}
        </div>
      )}
    </div>
  )
}
