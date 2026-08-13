"use client"

import { useRef, useEffect } from "react"
import type { TimelineEvent, Worktree } from "@/lib/control/types"
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

  // Scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events.length])

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-label="Conversation"
      className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
    >
      <div className="mx-auto w-full max-w-5xl space-y-5">
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
      </div>
    </div>
  )
}
