"use client"

import { useState } from "react"
import { Plus, Search, MoreVert, Pin } from "iconoir-react"
import type { Mission, Workspace, Worktree } from "@/lib/control/types"
import { formatCost } from "@/lib/control/seed"

type MissionFilter = "active" | "attention" | "done" | "archive"

const FILTERS: Array<{ id: MissionFilter; label: string }> = [
  { id: "active", label: "ACTIVE" },
  { id: "attention", label: "NEEDS YOU" },
  { id: "done", label: "DONE" },
  { id: "archive", label: "ARCHIVED" },
]

const STATUS_COLORS: Record<string, string> = {
  active: "bg-accent-blue",
  attention: "bg-accent-amber",
  completed: "bg-accent-green",
  archived: "bg-muted-foreground/50",
}

type Props = {
  missions: Mission[]
  selectedId: string
  filter: MissionFilter
  query: string
  onSelect: (id: string) => void
  onFilterChange: (filter: MissionFilter) => void
  onQueryChange: (query: string) => void
  onNewMission: () => void
  onPinToggle: (id: string) => void
  onArchiveToggle: (id: string) => void
  getWorkspace: (id: string) => Workspace | undefined
  worktrees: Worktree[]
}

export function MissionSidebar({
  missions,
  selectedId,
  filter,
  query,
  onSelect,
  onFilterChange,
  onQueryChange,
  onNewMission,
  onPinToggle,
  onArchiveToggle,
  getWorkspace,
  worktrees,
}: Props) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  // Sort: pinned first, then attention, then by id
  const sorted = [...missions].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1
    if ((a.status === "attention") !== (b.status === "attention"))
      return a.status === "attention" ? -1 : 1
    return 0
  })

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Missions</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {missions.length}
          </span>
        </div>
        <button
          onClick={onNewMission}
          className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-brand-accent-hover"
        >
          <Plus className="size-3.5" strokeWidth={2} />
          New
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search missions..."
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => onFilterChange(f.id)}
            className={`rounded px-2 py-1 font-mono text-[9px] font-medium tracking-wide transition-colors ${
              filter === f.id
                ? "bg-foreground text-background"
                : "border border-border bg-card text-muted-foreground hover:bg-secondary"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Mission list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {query ? `No missions match "${query}".` : "No missions in this state."}
          </div>
        ) : (
          sorted.map((m) => {
            const selected = m.id === selectedId
            const ws = getWorkspace(m.ws)
            const agentCount = worktrees.filter(
              (w) => w.mission === m.id && w.state !== "archived"
            ).length

            return (
              <div
                key={m.id}
                onClick={() => onSelect(m.id)}
                className={`group relative cursor-pointer border-b border-border px-3 py-2.5 transition-colors ${
                  selected ? "bg-secondary" : "hover:bg-secondary/50"
                }`}
              >
                {/* Left marker for selected */}
                {selected && (
                  <div className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
                )}

                {/* Top row: status dot + ID + age + menu */}
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${STATUS_COLORS[m.status] || "bg-muted"}`}
                  />
                  <span className="font-mono text-[10px] font-medium text-primary">
                    {m.id}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {m.age}
                  </span>
                  {m.pinned && (
                    <Pin className="size-3 text-accent-amber" strokeWidth={2} />
                  )}
                  <div className="ml-auto">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuOpen(menuOpen === m.id ? null : m.id)
                      }}
                      className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
                    >
                      <MoreVert className="size-3.5 text-muted-foreground" />
                    </button>
                    {menuOpen === m.id && (
                      <div className="absolute right-2 top-8 z-20 min-w-[120px] rounded-md border border-border bg-popover py-1 shadow-lg">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onPinToggle(m.id)
                            setMenuOpen(null)
                          }}
                          className="w-full px-3 py-1.5 text-left text-xs hover:bg-secondary"
                        >
                          {m.pinned ? "Unpin" : "Pin"}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onArchiveToggle(m.id)
                            setMenuOpen(null)
                          }}
                          className="w-full px-3 py-1.5 text-left text-xs hover:bg-secondary"
                        >
                          {m.archived ? "Unarchive" : "Archive"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Title */}
                <div className="mt-1 line-clamp-2 text-xs font-medium leading-snug">
                  {m.title}
                </div>

                {/* Meta row */}
                <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{ws?.name || m.ws}</span>
                  <span className="text-border">|</span>
                  <span>{agentCount} agents</span>
                  <span className="text-border">|</span>
                  <span className={m.cost > m.budget * 0.8 ? "text-accent-amber" : ""}>
                    {formatCost(m.cost)}
                  </span>
                </div>

                {/* Attention badge for non-selected items */}
                {m.status === "attention" && !selected && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded bg-accent-amber/10 px-1.5 py-0.5 font-mono text-[8px] font-medium text-accent-amber">
                    NEEDS YOU
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
