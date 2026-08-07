"use client"

import { useState, useCallback, useRef, useMemo } from "react"
import { SendDiagonal, PauseSolid, Plus, Xmark } from "iconoir-react"
import type { Mission, Worktree } from "@/lib/control/types"

type Props = {
  value: string
  onChange: (value: string) => void
  onSend: (text: string, target: string, scope: string) => void
  pending: boolean
  mission: Mission | undefined
  worktrees: Worktree[]
}

type Scope = "plan" | "implement" | "test" | "pipeline"

const SCOPE_LABELS: Record<Scope, string> = {
  plan: "PLAN ONLY",
  implement: "IMPLEMENT",
  test: "IMPLEMENT + TEST",
  pipeline: "FULL PIPELINE",
}

const SCOPES: Scope[] = ["plan", "implement", "test", "pipeline"]

const QUICK_PROMPTS = [
  { label: "Compare wt-a and wt-b", value: "Compare the implementations in wt-a and wt-b." },
  { label: "Try another approach", value: "Fork a new worktree and try a different approach." },
  { label: "Explain the conflict", value: "Explain the wt-d conflict and how to resolve it." },
]

export function Composer({ value, onChange, onSend, pending, mission: _mission, worktrees }: Props) {
  const [target, setTarget] = useState("mission")
  const [scope, setScope] = useState<Scope>("implement")
  const [attachments, setAttachments] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const targets = useMemo(
    () => ["mission", ...worktrees.filter((w) => w.state !== "archived").map((w) => w.id)],
    [worktrees]
  )

  const cycleTarget = useCallback(() => {
    const idx = targets.indexOf(target)
    setTarget(targets[(idx + 1) % targets.length])
  }, [targets, target])

  const cycleScope = useCallback(() => {
    const idx = SCOPES.indexOf(scope)
    setScope(SCOPES[(idx + 1) % SCOPES.length])
  }, [scope])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        if (value.trim() && !pending) {
          onSend(value.trim(), target, SCOPE_LABELS[scope])
          onChange("")
          setAttachments([])
        }
      }
    },
    [value, pending, target, scope, onSend, onChange]
  )

  const handleSend = useCallback(() => {
    if (value.trim() && !pending) {
      onSend(value.trim(), target, SCOPE_LABELS[scope])
      onChange("")
      setAttachments([])
    }
  }, [value, pending, target, scope, onSend, onChange])

  const addAttachment = useCallback(() => {
    const pool = ["spec/pricing-slo.md", "issue #4412", "trace TR-9021", "DEP-77 metrics"]
    const next = pool.find((p) => !attachments.includes(p))
    if (next) setAttachments((prev) => [...prev, next])
  }, [attachments])

  const removeAttachment = useCallback((name: string) => {
    setAttachments((prev) => prev.filter((a) => a !== name))
  }, [])

  return (
    <div className="border-t border-border bg-card">
      {/* Quick prompts row */}
      <div className="flex flex-wrap gap-1.5 border-b border-border/50 px-4 py-2">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt.label}
            onClick={() => {
              onChange(prompt.value)
              textareaRef.current?.focus()
            }}
            className="rounded border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {prompt.label}
          </button>
        ))}
      </div>

      {/* Attachments row */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border/50 px-4 py-2">
          {attachments.map((a) => (
            <div
              key={a}
              className="flex items-center gap-1 rounded border border-border bg-secondary px-2 py-1"
            >
              <span className="font-mono text-[10px]">{a}</span>
              <button onClick={() => removeAttachment(a)} className="text-muted-foreground hover:text-foreground">
                <Xmark className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main input area */}
      <div className="flex items-end gap-2 px-4 py-3">
        <div className="flex flex-1 flex-col gap-2">
          {/* Chips row */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={cycleTarget}
              className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-[10px] font-medium hover:bg-secondary"
            >
              <span
                className={`size-1.5 rounded-full ${target === "mission" ? "bg-primary" : "bg-accent-blue"}`}
              />
              {target === "mission" ? "MISSION" : target.toUpperCase()}
            </button>
            <button
              onClick={cycleScope}
              className="rounded border border-border bg-card px-2 py-1 text-[10px] font-medium hover:bg-secondary"
            >
              {SCOPE_LABELS[scope]}
            </button>
            <button
              onClick={addAttachment}
              className="flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Plus className="size-3" />
              Attach
            </button>
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              target === "mission"
                ? "Direct Mogplex - it will delegate to agents"
                : `Steer ${target} directly`
            }
            rows={1}
            className="min-h-[24px] flex-1 resize-y bg-transparent text-sm outline-none placeholder:text-muted-foreground [field-sizing:content]"
            disabled={pending}
          />

          {/* Hint */}
          <span className="text-[10px] text-muted-foreground">
            Enter to send · Shift+Enter for a new line
          </span>
        </div>

        {/* Send/Stop button */}
        {pending ? (
          <button
            onClick={() => {
              // Stop would need abort controller wired through
            }}
            className="flex size-8 items-center justify-center rounded-md bg-accent-red text-white hover:bg-accent-red/90"
          >
            <PauseSolid className="size-4" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!value.trim()}
            className={`flex size-8 items-center justify-center rounded-md transition-colors ${
              value.trim()
                ? "bg-primary text-primary-foreground hover:bg-brand-accent-hover"
                : "cursor-not-allowed bg-muted text-muted-foreground"
            }`}
          >
            <SendDiagonal className="size-4" strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  )
}
