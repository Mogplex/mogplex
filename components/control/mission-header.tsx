"use client"

import { Network, SendDiagonal, Settings } from "iconoir-react"
import type { Mission, Workspace } from "@/lib/control/types"

type ControlMode = "conversation" | "canvas" | "review"

type Props = {
  mission: Mission
  workspace: Workspace | undefined
  mode: ControlMode
  onModeChange: (mode: ControlMode) => void
}

const MODE_LABELS: Record<ControlMode, string> = {
  conversation: "Chat",
  canvas: "Canvas",
  review: "Review",
}

export function MissionHeader({ mission, workspace, mode, onModeChange }: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-transparent px-6">
      {/* Left: Breadcrumb */}
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="text-xl font-semibold">Command Center</h1>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-secondary px-2 text-xs text-secondary-foreground">
          <Network className="size-3.5 text-accent-blue" strokeWidth={1.5} aria-hidden="true" />
          Orchestrator
        </span>
      </div>

      {/* Center: Tabs */}
      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-secondary p-1 max-sm:hidden">
        {(["conversation", "canvas", "review"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === m
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <span className="hidden max-w-32 truncate font-mono text-xs text-muted-foreground sm:inline">
          {workspace?.name || mission.ws}
        </span>
        <button
          type="button"
          aria-label="Mission settings"
          title="Mission settings"
          className="grid size-8 place-items-center rounded-md border border-border bg-card text-foreground hover:bg-secondary"
        >
          <Settings className="size-3.5" strokeWidth={1.7} />
        </button>
        <button className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-brand-accent-hover">
          <SendDiagonal className="size-3.5" strokeWidth={1.7} />
          <span className="hidden sm:inline">Ship winner</span>
        </button>
      </div>
    </header>
  )
}
