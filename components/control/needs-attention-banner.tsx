"use client"

import type { Worktree, Changeset } from "@/lib/control/types"

type AttentionItem = {
  kind: "APPROVE" | "FAILED" | "CONFLICT"
  worktree: Worktree
  changeset?: Changeset
}

type Props = {
  item: AttentionItem
  onAction: () => void
  onSecondary: () => void
}

const STYLES = {
  APPROVE: {
    dot: "bg-accent-amber",
    label: "Approval required",
    action: "Approve merge",
    secondary: "Review changes",
  },
  FAILED: {
    dot: "bg-accent-red",
    label: "Run failed",
    action: "Retry run",
    secondary: "Open",
  },
  CONFLICT: {
    dot: "bg-accent-red",
    label: "Conflict to resolve",
    action: "Resolve conflict",
    secondary: "Open",
  },
}

export function NeedsAttentionBanner({ item, onAction, onSecondary }: Props) {
  const style = STYLES[item.kind]
  const title = item.changeset
    ? `${item.changeset.id} · ${item.worktree.task}`
    : `${item.worktree.id} · ${item.worktree.action}`

  return (
    <div className="flex items-center gap-3 border-b border-border bg-accent-amber/5 px-4 py-2.5">
      <span className={`size-2 shrink-0 rounded-full ${style.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{style.label}</div>
        <div className="truncate text-[10px] text-muted-foreground">{title}</div>
      </div>
      <button
        onClick={onSecondary}
        className="rounded border border-border px-2.5 py-1 text-[10px] font-medium hover:bg-secondary"
      >
        {style.secondary}
      </button>
      <button
        onClick={onAction}
        className="rounded bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground hover:bg-brand-accent-hover"
      >
        {style.action}
      </button>
    </div>
  )
}
