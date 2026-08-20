"use client"

import { useRef, useEffect } from "react"
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
  /** Rendered after the last event, inside the scroll area (e.g. the
   *  changed-files summary card once a run completes). */
  trailing?: React.ReactNode
}

export function Timeline({
  events,
  worktrees: _worktrees,
  getWorktree,
  onApprove,
  onToolApprovalResponse,
  pending,
  trailing,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Follow streamed content until the user scrolls away from the bottom.
  useEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    const bottom = bottomRef.current
    if (!scroll || !content || !bottom) return
    return setupTimelineAutoFollow(scroll, content, bottom)
  }, [])

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-label="Conversation"
      className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
    >
      <div ref={contentRef} className="mx-auto w-full max-w-5xl space-y-5">
        {events.map((event, idx) => (
          <TimelineCard
            key={`${event.kind}-${idx}`}
            event={event}
            eventIndex={idx}
            getWorktree={getWorktree}
            onApprove={onApprove}
            onToolApprovalResponse={onToolApprovalResponse}
          />
        ))}
        {pending && (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-ink-400">
            <span className="size-2 animate-pulse rounded-full bg-sky-400" />
            Mogplex is working...
          </div>
        )}
        {trailing}
        <div ref={bottomRef} aria-hidden="true" className="h-px" />
      </div>
    </div>
  )
}
