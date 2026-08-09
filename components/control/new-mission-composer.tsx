"use client"

import { useState, useCallback } from "react"
import { Attachment, Notes, Plus, SendDiagonal, Xmark } from "iconoir-react"
import { MISSION_PERMISSION_OPTIONS } from "@/lib/control/types"
import type { MissionPermissions, Workspace } from "@/lib/control/types"

type Props = {
  workspaces: Workspace[]
  onCancel?: () => void
  onCreate: (text: string, targets: string[], permissions: MissionPermissions) => void
}

export function NewMissionComposer({ workspaces, onCancel, onCreate }: Props) {
  const [text, setText] = useState("")
  const [targets, setTargets] = useState<string[]>(
    workspaces[0]?.id ? [workspaces[0].id] : []
  )
  const [permissionsIdx, setPermissionsIdx] = useState(0) // Default: Skip Permissions

  const activeWorkspaces = workspaces.filter((w) => w.status === "active")
  const availableToAdd = activeWorkspaces.filter((w) => !targets.includes(w.id))

  const cyclePermissions = useCallback(() => {
    setPermissionsIdx((i) => (i + 1) % MISSION_PERMISSION_OPTIONS.length)
  }, [])

  const addTarget = useCallback(() => {
    if (availableToAdd.length > 0) {
      setTargets((prev) => [...prev, availableToAdd[0].id])
    }
  }, [availableToAdd])

  const removeTarget = useCallback((id: string) => {
    setTargets((prev) => prev.filter((t) => t !== id))
  }, [])

  const handleSubmit = useCallback(() => {
    if (text.trim()) {
      onCreate(text.trim(), targets, MISSION_PERMISSION_OPTIONS[permissionsIdx])
    }
  }, [text, targets, permissionsIdx, onCreate])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && text.trim()) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [text, handleSubmit]
  )

  return (
    <div className="flex flex-1 flex-col justify-end px-4 py-5 sm:px-8">
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-[20px] font-semibold leading-7">Describe the outcome</h2>
          <p className="mt-1 text-sm leading-6 text-secondary-foreground">
            Mogplex plans it, starts the sandbox, and streams the run state here.
          </p>
        </div>

        {activeWorkspaces.length > 0 || targets.length > 0 ? (
          <div className="mb-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {targets.length} workspace{targets.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {targets.map((t) => {
                const ws = workspaces.find((w) => w.id === t)
                return (
                  <div
                    key={t}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5"
                  >
                    <span className="size-1.5 rounded-full bg-primary" />
                    <span className="text-xs font-medium">{ws?.name || t}</span>
                    {targets.length > 1 && (
                      <button
                        onClick={() => removeTarget(t)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Xmark className="size-3" />
                      </button>
                    )}
                  </div>
                )
              })}
              {availableToAdd.length > 0 && (
                <button
                  onClick={addTarget}
                  className="flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
                >
                  <Plus className="size-3" />
                  Add workspace
                </button>
              )}
            </div>
          </div>
        ) : null}

        {/* Input */}
        <div className="rounded-xl border border-border-dim bg-card p-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything or run a command..."
            rows={4}
            className="max-h-60 min-h-24 w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none placeholder:text-muted-foreground"
            autoFocus
          />

          {/* Options row */}
          <div className="mt-2 flex items-center gap-2 border-t border-border pt-3">
            <button
              type="button"
              className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Attach file"
            >
              <Attachment className="size-4" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground hover:bg-muted hover:text-foreground"
            >
              <Notes className="size-3.5" strokeWidth={1.6} />
              Plan
            </button>
            <button
              onClick={cyclePermissions}
              className="h-8 rounded-md border border-border px-2.5 text-xs font-medium text-secondary-foreground hover:bg-secondary hover:text-foreground"
            >
              {MISSION_PERMISSION_OPTIONS[permissionsIdx]}
            </button>

            <div className="ml-auto flex items-center gap-2">
              {onCancel ? (
                <button
                  onClick={onCancel}
                  className="h-8 rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary"
                >
                  Cancel
                </button>
              ) : null}
              <button
                onClick={handleSubmit}
                disabled={!text.trim()}
                className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                  text.trim()
                    ? "bg-primary text-primary-foreground hover:bg-brand-accent-hover"
                    : "cursor-not-allowed bg-muted text-muted-foreground"
                }`}
              >
                <SendDiagonal className="size-3.5" strokeWidth={1.8} />
                Start mission
              </button>
            </div>
          </div>
        </div>

        {/* Hint */}
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Enter to submit · Shift+Enter for a new line · ⌘K opens search
        </p>
      </div>
    </div>
  )
}
