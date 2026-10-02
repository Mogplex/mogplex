"use client"

import { useRef, useEffect, useState } from "react"
import { NavArrowDown, NavArrowUp } from "iconoir-react"
import type { TimelineEvent, Worktree } from "@/lib/control/types"
import { setupTimelineAutoFollow } from "@/lib/control/timeline-auto-follow"
import { TimelineCard } from "./timeline-card"
import type { ToolApprovalResponse } from "./timeline-card"

type Props = {
  events: TimelineEvent[]
  worktrees: Worktree[]
  getWorktree: (id: string) => Worktree | undefined
  onApprove: (eventIndex: number) => void
  onToolApprovalResponse?: (response: ToolApprovalResponse) => void
  pending: boolean
  /** Recorded runs keep the full transcript visible, including mid-run guidance. */
  collapseHistory?: boolean
  trailing?: React.ReactNode
}

export function Timeline({ events, getWorktree, onApprove, onToolApprovalResponse, pending, collapseHistory = true, trailing }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [expandedRequest, setExpandedRequest] = useState<number | null>(null)
  const latestRequest = collapseHistory ? events.findLastIndex((event) => event.kind === "user") : 0
  const requestCount = events.filter((event) => event.kind === "user").length
  const showHistory = expandedRequest === latestRequest
  const visibleStart = Math.max(latestRequest, 0)

  useEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    const bottom = bottomRef.current
    if (!scroll || !content || !bottom) return
    if (showHistory) {
      scroll.scrollTop = 0
      return
    }
    return setupTimelineAutoFollow(scroll, content, bottom)
  }, [showHistory, requestCount])

  const renderEvent = (event: TimelineEvent, idx: number) => <TimelineCard
    key={`${event.kind}-${idx}`}
    event={event}
    active={pending && idx >= visibleStart}
    eventIndex={idx}
    getWorktree={getWorktree}
    onApprove={onApprove}
    onToolApprovalResponse={onToolApprovalResponse}
  />
  const HistoryIcon = showHistory ? NavArrowUp : NavArrowDown

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {latestRequest > 0 && <div className="border-border shrink-0 border-b px-4 sm:px-6">
        <button type="button" aria-expanded={showHistory} onClick={() => setExpandedRequest(showHistory ? null : latestRequest)} className="text-muted-foreground hover:text-foreground mx-auto flex min-h-10 w-full max-w-5xl items-center gap-2 text-xs focus-visible:outline-2 focus-visible:outline-ring">
          <HistoryIcon aria-hidden="true" className="size-4" />
          {showHistory ? "Hide earlier conversation" : "Earlier conversation"} · {requestCount - 1} request{requestCount === 2 ? "" : "s"}
        </button>
      </div>}
      <div ref={scrollRef} role="log" aria-label="Conversation" className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div ref={contentRef} className="mx-auto w-full max-w-5xl space-y-5">
          {showHistory && <div className="border-border space-y-5 border-b pb-5">{events.slice(0, latestRequest).map(renderEvent)}</div>}
          <section aria-label={collapseHistory ? "Latest request" : "Recorded run"} aria-busy={pending} className="space-y-4">
            {events.slice(visibleStart).map((event, index) => renderEvent(event, visibleStart + index))}
          </section>
          {trailing}
          <div ref={bottomRef} aria-hidden="true" className="h-px" />
        </div>
      </div>
    </div>
  )
}
