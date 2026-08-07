"use client"

import { Settings, SendDiagonal } from "iconoir-react"
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
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
      {/* Left: Breadcrumb */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {workspace?.name?.toLowerCase() || "workspace"}
        </span>
        <span className="text-muted-foreground/50">/</span>
        <span className="font-mono text-[11.5px] font-semibold text-primary">
          {mission.id}
        </span>
        <span className="text-muted-foreground/50">/</span>
        <span className="truncate text-sm font-semibold">{mission.title}</span>
      </div>

      {/* Center: Tabs */}
      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
        {(["conversation", "canvas", "review"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={`relative px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === m ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {MODE_LABELS[m]}
            {mode === m && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {workspace?.name || mission.ws}
        </span>
        <button className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[11px] font-medium text-foreground hover:bg-secondary">
          <Settings className="size-3.5" strokeWidth={1.7} />
          <span className="hidden sm:inline">Mission settings</span>
        </button>
        <button className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:bg-brand-accent-hover">
          <SendDiagonal className="size-3.5" strokeWidth={1.7} />
          <span className="hidden sm:inline">Ship winner</span>
        </button>
      </div>
    </header>
  )
}
