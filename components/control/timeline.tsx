"use client"

import { useRef, useEffect } from "react"
import type { TimelineEvent, Worktree } from "@/lib/control/types"
import { setupTimelineAutoFollow } from "@/lib/control/timeline-auto-follow"
import { timelineSections } from "@/lib/control/timeline-sections"
import { TimelineCard } from "./timeline-card"
import type { ToolApprovalResponse } from "./timeline-card"

type Props = {
  events: TimelineEvent[]
  worktrees: Worktree[]
  getWorktree: (id: string) => Worktree | undefined
  onApprove: (eventIndex: number) => void
  onToolApprovalResponse?: (response: ToolApprovalResponse) => void
  pending: boolean
  activeMessageId?: string
  recordedRun?: boolean
  trailing?: React.ReactNode
}

export function Timeline({ events, getWorktree, onApprove, onToolApprovalResponse, pending, activeMessageId, recordedRun = false, trailing }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const latestRequest = recordedRun ? 0 : Math.max(events.findLastIndex((event) => event.kind === "user"), 0)
  const requestCount = events.filter((event) => event.kind === "user").length
  const sections = timelineSections(events, recordedRun)

  useEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    const bottom = bottomRef.current
    if (!scroll || !content || !bottom) return
    return setupTimelineAutoFollow(scroll, content, bottom)
  }, [requestCount])

  const renderEvent = (event: TimelineEvent, idx: number) => <TimelineCard
    key={event.id ?? `activity-${idx}`}
    event={event}
    active={pending && (recordedRun || (event.messageId ? event.messageId === activeMessageId : idx >= latestRequest))}
    eventIndex={idx}
    getWorktree={getWorktree}
    onApprove={onApprove}
    onToolApprovalResponse={onToolApprovalResponse}
  />
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} role="log" aria-label="Conversation" className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div ref={contentRef} className="mx-auto w-full max-w-5xl space-y-5">
          {sections.map(({ key, label, start, end }) => <section key={key} aria-label={label} aria-busy={pending && (activeMessageId ? events.slice(start, end).some(event => event.messageId === activeMessageId) : start === latestRequest)} className="space-y-4">
            {events.slice(start, end).map((event, index) => renderEvent(event, start + index))}
          </section>)}
          {trailing}
          <div ref={bottomRef} aria-hidden="true" className="h-px" />
        </div>
      </div>
    </div>
  )
}
