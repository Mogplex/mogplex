"use client"
import { useCallback, useMemo, useState } from "react"
import { useSelectedAgent, useOutputPaneTab } from "./agent-roster-pane"
import { useAgentRosterSummary } from "@/hooks/use-agent-roster-summary"
import {
  useObservabilityCalls,
  useObservabilityJobs,
  useObservabilityAutomationEvents,
} from "@/hooks/use-observability"
import type { AgentRosterItem } from "@/app/api/agents/roster/route"
import type { ObservabilityJob, AutomationDispatchEvent } from "@/lib/types"
import useSWR from "swr"
import {
  formatTokens,
  formatDispatchReason,
  getJobAutomationSummary,
  timeAgo,
} from "@/app/(dashboard)/[scope]/observability/_components/formatters"
import {
  StatusBadge,
  PressureOutcomeBadge,
} from "@/app/(dashboard)/[scope]/observability/_components/badges"
import { AutomationInlineCostSummary } from "@/app/(dashboard)/[scope]/observability/_components/automation-presentation-cells"
import {
  formatAutomationTimeoutBudgetLabel,
  getAutomationStatusPresentation,
} from "@/lib/observability/automation-run-presentation"

const rosterFetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`API error: ${r.status}`)
  return r.json()
}

const STATUS_COLORS: Record<string, string> = {
  streaming: "text-accent-green",
  success: "text-accent-blue",
  failed: "text-accent-red",
  pending: "text-amber-400",
  cancelled: "text-muted-foreground",
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function OutputPane() {
  const agentId = useSelectedAgent((s) => s.agentId)
  const { tab, setTab } = useOutputPaneTab()

  const { data: roster } = useSWR<AgentRosterItem[]>("/api/agents/roster", rosterFetcher)
  const { summary } = useAgentRosterSummary()

  const agent = useMemo(
    () => roster?.find((a) => a.id === agentId) ?? null,
    [roster, agentId]
  )
  const health = agentId ? summary[agentId] : undefined

  if (!agentId) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-sm text-muted-foreground">
        Select an agent to view output
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {agent && <AgentContextHeader agent={agent} health={health} />}
      <TabBar tab={tab} setTab={setTab} />
      <div className="flex-1 overflow-auto">
        {tab === "activity" && <ActivityTab agentId={agentId} />}
        {tab === "calls" && <CallsTab agentId={agentId} />}
        {tab === "events" && <EventsTab agentId={agentId} />}
      </div>
    </div>
  )
}

function AgentContextHeader({
  agent,
  health,
}: {
  agent: AgentRosterItem
  health?: { runs24h: number; succeeded: number; failed: number; tokens24h: number }
}) {
  const rate = health && health.runs24h > 0
    ? Math.round((health.succeeded / health.runs24h) * 100)
    : null

  return (
    <div className="flex items-center gap-2 px-3 h-7 border-b border-border-dim text-[11px] font-mono text-muted-foreground overflow-hidden">
      <span className="text-foreground font-medium truncate">{agent.name}</span>
      {rate !== null && (
        <>
          <span>·</span>
          <span className={health!.failed > 0 ? "text-accent-red" : ""}>{rate}% (24h)</span>
        </>
      )}
      {agent.status === "running" && (
        <>
          <span>·</span>
          <span className="text-accent-green">running</span>
        </>
      )}
    </div>
  )
}

function TabBar({
  tab,
  setTab,
}: {
  tab: "activity" | "calls" | "events"
  setTab: (t: "activity" | "calls" | "events") => void
}) {
  const tabs: { key: typeof tab; label: string }[] = [
    { key: "activity", label: "Activity" },
    { key: "calls", label: "Calls" },
    { key: "events", label: "Events" },
  ]

  return (
    <div className="flex items-center gap-0 border-b border-border px-2">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={`px-2.5 py-1.5 text-[11px] font-medium border-b-2 transition-colors ${
            tab === t.key
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function ActivityTab({ agentId }: { agentId: string }) {
  const filters = useMemo(
    () => ({ agentId, page: 1, limit: 30, sort: "created_at", order: "desc" as const }),
    [agentId]
  )
  const { data, isLoading } = useObservabilityJobs(filters)
  const [actionId, setActionId] = useState<string | null>(null)

  const runAction = useCallback(async (jobId: string, action: "repair" | "requeue" | "cancel") => {
    setActionId(jobId)
    try {
      await fetch(`/api/observability/jobs/${jobId}/${action}`, { method: "POST" })
    } finally {
      setActionId(null)
    }
  }, [])

  if (isLoading) {
    return <div className="p-3 text-sm text-muted-foreground">Loading runs...</div>
  }

  const jobs = data?.jobs ?? []

  if (jobs.length === 0) {
    return <div className="p-3 text-sm text-muted-foreground">No runs recorded</div>
  }

  return (
    <div className="divide-y divide-border-dim">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} actionId={actionId} onAction={runAction} />
      ))}
    </div>
  )
}

function JobRow({
  job,
  actionId,
  onAction,
}: {
  job: ObservabilityJob
  actionId: string | null
  onAction: (jobId: string, action: "repair" | "requeue" | "cancel") => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const automationSummary = getJobAutomationSummary(job)
  const repoName = job.repo.full_name?.split("/").pop() ?? "—"
  const isActing = actionId === job.id
  const statusPresentation = getAutomationStatusPresentation({
    status: job.status,
    metadata: job.latest_dispatch_event?.metadata,
    error: job.error,
  })
  const timeoutBudget = formatAutomationTimeoutBudgetLabel(
    statusPresentation.timeoutBudgetMs
  )

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground shrink-0 w-14 font-mono">
            {timeAgo(job.created_at)}
          </span>
          <StatusBadge status={job.status} label={statusPresentation.label} />
          <span className="text-[11px] text-muted-foreground truncate">{repoName}</span>
          <span className="text-[11px] text-muted-foreground">·</span>
          <span className="text-[11px] text-muted-foreground capitalize">
            {job.source_type.replace("_", " ")}
          </span>
          <div className="flex-1" />
          {job.latest_ai_call && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              {formatTokens(job.latest_ai_call.total_tokens)} · {job.latest_ai_call.tool_calls_count} tools
            </span>
          )}
        </div>
        {automationSummary && (
          <div className="text-[11px] text-secondary-foreground mt-0.5 ml-[60px] truncate">
            {automationSummary}
          </div>
        )}
      </button>
        {expanded && (
        <div className="px-3 pb-2 ml-[60px] space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground font-mono">
            {timeoutBudget && <span>{timeoutBudget}</span>}
            <AutomationInlineCostSummary
              status={job.status}
              costUsd={job.cost_usd}
            />
          </div>
          {job.latest_dispatch_event && (
            <div className="flex items-center gap-2 text-[11px]">
              <PressureOutcomeBadge outcome={job.latest_dispatch_event.outcome} />
              {job.latest_dispatch_event.reason && (
                <span className="text-muted-foreground">
                  {formatDispatchReason(job.latest_dispatch_event.reason, job.latest_dispatch_event.metadata)}
                </span>
              )}
            </div>
          )}
          {job.latest_ai_call && (
            <div className="text-[10px] text-muted-foreground font-mono">
              {job.latest_ai_call.model} · {job.start_attempts} attempt{job.start_attempts !== 1 ? "s" : ""}
            </div>
          )}
          {(job.repairable || job.requeueable || job.cancelable) && (
            <div className="flex items-center gap-1.5 pt-0.5">
              {job.repairable && (
                <button
                  onClick={(e) => { e.stopPropagation(); void onAction(job.id, "repair") }}
                  disabled={isActing}
                  className="px-2 py-0.5 text-[10px] border border-border rounded hover:bg-secondary disabled:opacity-50"
                >
                  Repair
                </button>
              )}
              {job.requeueable && (
                <button
                  onClick={(e) => { e.stopPropagation(); void onAction(job.id, "requeue") }}
                  disabled={isActing}
                  className="px-2 py-0.5 text-[10px] border border-border rounded hover:bg-secondary disabled:opacity-50"
                >
                  Requeue
                </button>
              )}
              {job.cancelable && (
                <button
                  onClick={(e) => { e.stopPropagation(); void onAction(job.id, "cancel") }}
                  disabled={isActing}
                  className="px-2 py-0.5 text-[10px] border border-border rounded hover:bg-secondary disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CallsTab({ agentId }: { agentId: string }) {
  const filters = useMemo(
    () => ({
      page: 1,
      limit: 50,
      sort: "started_at",
      order: "desc" as const,
      agentId,
    }),
    [agentId]
  )
  const { data, isLoading } = useObservabilityCalls(filters)
  const hasStreaming = data?.calls?.some((c) => c.status === "streaming")

  if (isLoading) {
    return <div className="p-3 text-sm text-muted-foreground">Loading calls...</div>
  }

  const calls = data?.calls ?? []

  return (
    <div className="font-mono text-[12px]">
      {hasStreaming && (
        <div className="flex items-center gap-1.5 px-3 h-5 border-b border-border-dim">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
          <span className="text-[11px] text-accent-green">streaming</span>
        </div>
      )}
      <div className="p-2 space-y-1">
        {calls.length === 0 && (
          <div className="text-muted-foreground text-sm p-2">No calls recorded</div>
        )}
        {calls.map((call) => (
          <div key={call.id} className="flex items-start gap-2 py-0.5">
            <span className="text-muted-foreground shrink-0 w-16">{formatTime(call.started_at)}</span>
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded-[2px] text-[11px] ${
                STATUS_COLORS[call.status] || "text-muted-foreground"
              }`}
            >
              {call.status}
            </span>
            <span className="text-secondary-foreground truncate">
              {call.model} · {call.type}
              {call.total_tokens ? ` · ${call.total_tokens} tok` : ""}
              {call.duration_ms ? ` · ${call.duration_ms}ms` : ""}
            </span>
          </div>
        ))}
        {hasStreaming && (
          <div className="text-accent-green animate-pulse">▌</div>
        )}
      </div>
    </div>
  )
}

function EventsTab({ agentId }: { agentId: string }) {
  const filters = useMemo(
    () => ({ agentId, page: 1, limit: 30 }),
    [agentId]
  )
  const { data, isLoading } = useObservabilityAutomationEvents(filters)

  if (isLoading) {
    return <div className="p-3 text-sm text-muted-foreground">Loading events...</div>
  }

  const events = data?.events ?? []

  if (events.length === 0) {
    return <div className="p-3 text-sm text-muted-foreground">No dispatch events</div>
  }

  return (
    <div className="divide-y divide-border-dim">
      {events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
    </div>
  )
}

function EventRow({ event }: { event: AutomationDispatchEvent }) {
  const repoName = event.repo.full_name?.split("/").pop() ?? "—"

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground shrink-0 w-14 font-mono">
          {timeAgo(event.created_at)}
        </span>
        <PressureOutcomeBadge outcome={event.outcome} />
        <span className="text-[11px] text-muted-foreground truncate">{repoName}</span>
        <span className="text-[11px] text-muted-foreground">·</span>
        <span className="text-[11px] text-muted-foreground capitalize">
          {event.source_type.replace("_", " ")}
        </span>
      </div>
      {event.reason && (
        <div className="text-[11px] text-secondary-foreground mt-0.5 ml-[60px] truncate">
          {formatDispatchReason(event.reason, event.metadata)}
        </div>
      )}
    </div>
  )
}
