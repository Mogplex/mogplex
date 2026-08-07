"use client"

import { useRef, useEffect } from "react"
import type { TimelineEvent, Worktree } from "@/lib/control/types"
import { TimelineCard } from "./timeline-card"

type Props = {
  events: TimelineEvent[]
  worktrees: Worktree[]
  getWorktree: (id: string) => Worktree | undefined
  onSelectWorktree: (id: string, tab?: string) => void
  onApprove: (eventIndex: number) => void
  pending: boolean
}

export function Timeline({
  events,
  worktrees: _worktrees,
  getWorktree,
  onSelectWorktree,
  onApprove,
  pending,
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
      className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6"
    >
      <div className="mx-auto max-w-2xl space-y-3">
        {events.map((event, idx) => (
          <TimelineCard
            key={`${event.kind}-${idx}`}
            event={event}
            eventIndex={idx}
            getWorktree={getWorktree}
            onSelectWorktree={onSelectWorktree}
            onApprove={onApprove}
          />
        ))}
        {pending && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <span className="size-2 animate-pulse rounded-full bg-primary" />
            Mogplex is planning...
          </div>
        )}
      </div>
    </div>
  )
}
