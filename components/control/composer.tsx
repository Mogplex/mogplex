"use client"

import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import { SendDiagonal, PauseSolid } from "iconoir-react"
import { McpStatusButton } from "@/components/chat/mcp-status-button"
import { useModels } from "@/hooks/use-models"
import { MISSION_PERMISSION_OPTIONS } from "@/lib/control/types"
import type { Mission, MissionPermissions, Worktree } from "@/lib/control/types"

export type ComposerSendOptions = {
  model: string | null
  permissions: MissionPermissions
}

type Props = {
  value: string
  onChange: (value: string) => void
  onSend: (text: string, target: string, scope: string, options: ComposerSendOptions) => void
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

function shortModelName(modelId: string) {
  return modelId.split("/").pop() ?? modelId
}

function ModelChip({
  modelId,
  modelIds,
  onSelect,
  disabled,
}: {
  modelId: string | null
  modelIds: string[]
  onSelect: (modelId: string) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (btnRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const filtered = modelIds.filter(
    (m) => !filter || m.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="relative">
      <button
        ref={btnRef}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => {
            if (!o && btnRef.current) {
              const rect = btnRef.current.getBoundingClientRect()
              setMenuPos({ left: rect.left, bottom: window.innerHeight - rect.top + 4 })
            }
            return !o
          })
          setFilter("")
        }}
        className="rounded border border-border bg-card px-2 py-1 text-[10px] font-medium text-accent-blue hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {modelId ? shortModelName(modelId) : "Model"}
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] flex max-h-56 w-72 flex-col border border-border bg-card shadow-lg"
          style={{ left: menuPos.left, bottom: menuPos.bottom }}
        >
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search models..."
            className="border-b border-border bg-input px-2 py-1.5 text-[11px] text-foreground outline-none"
            autoFocus
          />
          <div className="flex-1 overflow-auto">
            {filtered.length === 0 && (
              <div className="px-2 py-1.5 text-[11px] text-muted-foreground">No models</div>
            )}
            {filtered.map((m) => (
              <button
                key={m}
                onClick={() => {
                  onSelect(m)
                  setOpen(false)
                  setFilter("")
                }}
                className={`w-full px-2 py-1.5 text-left text-[11px] hover:bg-secondary/50 ${
                  m === modelId ? "bg-accent-blue/5 text-accent-blue" : "text-foreground"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export function Composer({ value, onChange, onSend, pending, mission: _mission, worktrees }: Props) {
  const [target, setTarget] = useState("mission")
  const [scope, setScope] = useState<Scope>("implement")
  const [permissionsIdx, setPermissionsIdx] = useState(0) // Default: Skip Permissions
  const { modelIds, defaultModelId } = useModels()
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  // The user's pick wins; until then follow their account default so the chip
  // never shows a model the send path wouldn't actually use.
  const modelId = selectedModel ?? defaultModelId ?? modelIds[0] ?? null
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const targets = useMemo(
    () => ["mission", ...worktrees.filter((w) => w.state !== "archived").map((w) => w.id)],
    [worktrees]
  )

  const quickPrompts = useMemo(() => {
    const active = worktrees.filter((w) => w.state !== "archived")
    const prompts = [
      { label: "Try another approach", value: "Fork a new worktree and try a different approach." },
    ]
    if (active.length >= 2) {
      prompts.unshift({
        label: `Compare ${active[0].id} and ${active[1].id}`,
        value: `Compare the implementations in ${active[0].id} and ${active[1].id}.`,
      })
    }
    const blocked = worktrees.find((w) => w.state === "blocked")
    if (blocked) {
      prompts.push({
        label: "Explain the conflict",
        value: `Explain the ${blocked.id} conflict and how to resolve it.`,
      })
    }
    return prompts
  }, [worktrees])

  const cycleTarget = useCallback(() => {
    const idx = targets.indexOf(target)
    setTarget(targets[(idx + 1) % targets.length])
  }, [targets, target])

  const cycleScope = useCallback(() => {
    const idx = SCOPES.indexOf(scope)
    setScope(SCOPES[(idx + 1) % SCOPES.length])
  }, [scope])

  const cyclePermissions = useCallback(() => {
    setPermissionsIdx((i) => (i + 1) % MISSION_PERMISSION_OPTIONS.length)
  }, [])

  const handleSend = useCallback(() => {
    if (value.trim() && !pending) {
      onSend(value.trim(), target, SCOPE_LABELS[scope], {
        model: modelId,
        permissions: MISSION_PERMISSION_OPTIONS[permissionsIdx],
      })
      onChange("")
    }
  }, [value, pending, target, scope, modelId, permissionsIdx, onSend, onChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  return (
    <div className="border-t border-border bg-card">
      {/* Quick prompts row */}
      <div className="flex flex-wrap gap-1.5 border-b border-border/50 px-4 py-2">
        {quickPrompts.map((prompt) => (
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
              onClick={cyclePermissions}
              className="rounded border border-border bg-card px-2 py-1 text-[10px] font-medium hover:bg-secondary"
            >
              {MISSION_PERMISSION_OPTIONS[permissionsIdx]}
            </button>
            <ModelChip
              modelId={modelId}
              modelIds={modelIds}
              onSelect={setSelectedModel}
              disabled={pending}
            />
            <span className="ml-auto text-[12px] text-muted-foreground">
              <McpStatusButton />
            </span>
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
