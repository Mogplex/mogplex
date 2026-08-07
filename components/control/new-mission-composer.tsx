"use client"

import { useState, useCallback } from "react"
import { Xmark, Plus, SendDiagonal } from "iconoir-react"
import type { Workspace } from "@/lib/control/types"

type Props = {
  workspaces: Workspace[]
  onCancel?: () => void
  onCreate: (text: string, targets: string[], autonomy: string, budget: number) => void
}

const AUTONOMY_OPTIONS = ["Read-only", "Supervised", "Autonomous"]
const BUDGET_OPTIONS = [30, 60, 120, 250]

const EXAMPLE_PROMPTS = [
  { label: "Cut checkout p95 latency below 400ms", scope: "pricing" },
  { label: "Move invoice tax rules behind a feature flag", scope: "ledger" },
  { label: "Cut checkout latency and surface the new numbers on the console dashboard", scope: "2 projects" },
]

export function NewMissionComposer({ workspaces, onCancel, onCreate }: Props) {
  const [text, setText] = useState("")
  const [targets, setTargets] = useState<string[]>([workspaces[0]?.id || ""])
  const [autonomyIdx, setAutonomyIdx] = useState(1) // Default: Supervised
  const [budgetIdx, setBudgetIdx] = useState(1) // Default: $60

  const activeWorkspaces = workspaces.filter((w) => w.status === "active")
  const availableToAdd = activeWorkspaces.filter((w) => !targets.includes(w.id))

  const cycleAutonomy = useCallback(() => {
    setAutonomyIdx((i) => (i + 1) % AUTONOMY_OPTIONS.length)
  }, [])

  const cycleBudget = useCallback(() => {
    setBudgetIdx((i) => (i + 1) % BUDGET_OPTIONS.length)
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
      onCreate(text.trim(), targets, AUTONOMY_OPTIONS[autonomyIdx], BUDGET_OPTIONS[budgetIdx])
    }
  }, [text, targets, autonomyIdx, budgetIdx, onCreate])

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
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-xl font-semibold">Describe the outcome</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mogplex plans it and picks the agents
          </p>
        </div>

        {/* Example prompts */}
        <div className="flex flex-wrap justify-center gap-2">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt.label}
              onClick={() => setText(prompt.label)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs transition-colors hover:bg-secondary"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-primary" />
              <span className="line-clamp-1">{prompt.label}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{prompt.scope}</span>
            </button>
          ))}
        </div>

        {/* Targets */}
        <div className="space-y-2">
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
                  className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5"
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
                className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
              >
                <Plus className="size-3" />
                Add workspace
              </button>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to achieve..."
            rows={4}
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />

          {/* Options row */}
          <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
            <button
              onClick={cycleAutonomy}
              className="rounded border border-border px-2.5 py-1 text-[10px] font-medium hover:bg-secondary"
            >
              {AUTONOMY_OPTIONS[autonomyIdx]}
            </button>
            <button
              onClick={cycleBudget}
              className="rounded border border-border px-2.5 py-1 text-[10px] font-medium hover:bg-secondary"
            >
              ${BUDGET_OPTIONS[budgetIdx]} cap
            </button>

            <div className="ml-auto flex items-center gap-2">
              {onCancel ? (
                <button
                  onClick={onCancel}
                  className="rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                >
                  Cancel
                </button>
              ) : null}
              <button
                onClick={handleSubmit}
                disabled={!text.trim()}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
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
        <p className="text-center text-[10px] text-muted-foreground">
          Enter to submit · Shift+Enter for a new line
        </p>
      </div>
    </div>
  )
}
