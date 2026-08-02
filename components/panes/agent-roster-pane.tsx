"use client"
import { useMemo, useState } from "react"
import { useParams } from "next/navigation"
import useSWR from "swr"
import { scopedHref } from "@/lib/scoped-href"
import type { AgentRosterItem } from "@/app/api/agents/roster/route"
import { create } from "zustand"
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh"
import { useAgentRosterSummary } from "@/hooks/use-agent-roster-summary"
import { AgentCreatorDialog } from "@/components/agent-creator-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatTokens } from "@/app/(dashboard)/[scope]/observability/_components/formatters"

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`API error: ${r.status}`)
  return r.json()
}

export const useSelectedAgent = create<{
  agentId: string | null
  setAgentId: (id: string | null) => void
}>((set) => ({
  agentId: null,
  setAgentId: (id) => set({ agentId: id }),
}))

export const useOutputPaneTab = create<{
  tab: "activity" | "calls" | "events"
  setTab: (tab: "activity" | "calls" | "events") => void
}>((set) => ({
  tab: "activity",
  setTab: (tab) => set({ tab }),
}))

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never"
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const STATUS_DOT: Record<string, string> = {
  running: "text-accent-green",
  idle: "text-muted-foreground",
  error: "text-accent-red",
}

export function AgentRosterPane() {
  const { scope } = useParams<{ scope: string }>()
  const { data: roster, isLoading, mutate } = useSWR<AgentRosterItem[]>(
    "/api/agents/roster",
    fetcher
  )
  const { summary } = useAgentRosterSummary()
  const { agentId, setAgentId } = useSelectedAgent()
  const setTab = useOutputPaneTab((s) => s.setTab)
  const [showCreator, setShowCreator] = useState(false)

  const realtimeSpecs = useMemo(() => [
    { table: "agents", filter: "user_id=eq.$USER_ID" },
    { table: "assignments" },
    { table: "ai_calls", filter: "user_id=eq.$USER_ID" },
  ], [])
  useRealtimeRouteRefresh({
    channelName: "agent-roster-pane",
    specs: realtimeSpecs,
    onInvalidate: mutate,
  })

  const selectAndView = (id: string, tab: "activity" | "calls" | "events") => {
    setAgentId(id)
    setTab(tab)
  }

  const newAgentButton = (
    <div className="px-3 py-2 border-b border-border">
      <button
        onClick={() => setShowCreator(true)}
        className="w-full px-2 py-1.5 text-xs text-foreground bg-secondary hover:bg-secondary/80 rounded transition-colors flex items-center justify-center gap-1.5"
      >
        <span className="text-muted-foreground">+</span> New Agent
      </button>
    </div>
  )

  const creatorDialog = showCreator && (
    <AgentCreatorDialog
      onClose={() => setShowCreator(false)}
      onCreated={() => mutate()}
    />
  )

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col">
        {newAgentButton}
        <div className="flex-1 p-3 text-sm text-muted-foreground">Loading agents...</div>
        {creatorDialog}
      </div>
    )
  }

  if (!roster?.length) {
    return (
      <div className="flex-1 flex flex-col">
        {newAgentButton}
        <div className="flex-1 flex items-center justify-center p-4 text-sm text-muted-foreground">
          No agents configured.{" "}
          <a href={scopedHref(scope, "/agents")} className="text-accent-blue hover:underline ml-1">
            Set up agents
          </a>
        </div>
        {creatorDialog}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {newAgentButton}
      <div className="flex-1 overflow-auto">
        {roster.map((agent) => {
          const health = summary[agent.id]
          return (
            <div
              key={agent.id}
              className={`flex items-start gap-2 w-full px-3 py-2 border-b border-border-dim hover:bg-secondary/50 transition-colors ${
                agent.id === agentId ? "bg-secondary" : ""
              }`}
            >
              <button
                onClick={() => setAgentId(agent.id === agentId ? null : agent.id)}
                className="flex items-start gap-2 min-w-0 flex-1 text-left"
              >
                <span className={`mt-0.5 text-[10px] ${STATUS_DOT[agent.status]}`}>●</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-foreground truncate">{agent.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{agent.description}</div>
                  {health && health.runs24h > 0 && (
                    <HealthLine health={health} />
                  )}
                </div>
              </button>
              <div className="flex items-start gap-1 shrink-0">
                <div className="text-right">
                  <div className="text-[11px] text-muted-foreground">{agent.cycleCount} cycles</div>
                  <div className="text-[11px] text-muted-foreground">{timeAgo(agent.lastActivity)}</div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="Agent actions"
                      className="px-0.5 py-0.5 text-muted-foreground hover:text-foreground rounded hover:bg-secondary text-[11px] shrink-0"
                    >
                      ···
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-36">
                    <DropdownMenuItem onSelect={() => selectAndView(agent.id, "activity")}>
                      View Runs
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => selectAndView(agent.id, "events")}>
                      View Events
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <a href={scopedHref(scope, "/agents/roster")}>Edit Agent</a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )
        })}
      </div>
      {creatorDialog}
    </div>
  )
}

function HealthLine({ health }: { health: { runs24h: number; succeeded: number; failed: number; tokens24h: number } }) {
  const rate = health.runs24h > 0 ? Math.round((health.succeeded / health.runs24h) * 100) : 0
  const hasFailed = health.failed > 0

  return (
    <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
      <span className="text-muted-foreground">{health.runs24h} runs</span>
      <span className="text-muted-foreground">·</span>
      <span className={hasFailed ? "text-accent-red" : "text-muted-foreground"}>
        {hasFailed ? `${health.failed} failed` : `${rate}%`}
      </span>
      {health.tokens24h > 0 && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{formatTokens(health.tokens24h)}</span>
        </>
      )}
    </div>
  )
}
