"use client"

import { useState } from "react"
import { Terminal, NavArrowUp, Xmark } from "iconoir-react"
import type { Worktree } from "@/lib/control/types"

type Tab = "terminal" | "logs" | "tests" | "events"

type Props = {
  open: boolean
  onToggle: () => void
  tab: Tab
  onTabChange: (tab: Tab) => void
  height: number
  onCycleHeight: () => void
  selection: string | null
  worktrees: Worktree[]
  getWorktree: (id: string) => Worktree | undefined
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "terminal", label: "Terminal" },
  { id: "logs", label: "Logs" },
  { id: "tests", label: "Tests" },
  { id: "events", label: "Events" },
]

type Line = { gutter: string; text: string; color: string; tail?: string }

export function ConsoleDrawer({
  open,
  onToggle,
  tab,
  onTabChange,
  height,
  onCycleHeight,
  selection,
  worktrees,
  getWorktree,
}: Props) {
  const [terminalLog, setTerminalLog] = useState<string[]>([])
  const [terminalInput, setTerminalInput] = useState("")

  // Get active worktree for terminal context
  const scope = selection?.startsWith("wt-") ? selection : "wt-a"
  const wt = getWorktree(scope) || worktrees[0]

  const getLines = (): Line[] => {
    if (tab === "terminal") {
      const baseLines: Line[] = [
        { gutter: "$", text: `cd /worktrees/${wt?.branch || "main"}`, color: "var(--terminal-foreground)" },
        { gutter: "$", text: "pnpm bench pricing --iterations 200", color: "var(--terminal-foreground)" },
        { gutter: " ", text: "bench | warmup 20 iterations", color: "var(--terminal-muted)" },
        { gutter: " ", text: "bench | baseline p95 812ms", color: "var(--border)" },
        { gutter: " ", text: `bench | candidate p95 ${wt?.id === "wt-a" ? "392ms" : "418ms"}`, color: "var(--accent-green)" },
        { gutter: " ", text: `bench | delta ${wt?.id === "wt-a" ? "-51.7%" : "-48.5%"}`, color: "var(--accent-green)" },
      ]
      terminalLog.forEach((l) => {
        baseLines.push({ gutter: "$", text: l, color: "var(--terminal-foreground)" })
      })
      return baseLines
    }

    if (tab === "logs") {
      return [
        { gutter: "12:04:11", text: "api      | GET /pricing/quote 200 486ms", color: "var(--border)" },
        { gutter: "12:04:11", text: "cache    | miss price_book:eu-west", color: "var(--accent-amber)" },
        { gutter: "12:04:12", text: "api      | GET /pricing/quote 200 121ms", color: "var(--border)" },
        { gutter: "12:04:14", text: "deploy   | DEP-77 rollout 60% · error_rate 1.4%", color: "var(--accent-red)" },
        { gutter: "12:04:15", text: "cache    | hit ratio 0.71 (target 0.85)", color: "var(--accent-amber)" },
        { gutter: "12:04:18", text: "api      | GET /pricing/quote 200 108ms", color: "var(--border)" },
      ]
    }

    if (tab === "tests") {
      return [
        { gutter: "PASS", text: "test/pricing.spec.ts · 214 assertions", color: "var(--accent-green)", tail: "46s" },
        { gutter: "PASS", text: "test/resolver.spec.ts · 88 assertions", color: "var(--accent-green)", tail: "21s" },
        { gutter: "FAIL", text: "test/pricing.bench.ts · p95 gate 418ms > 400ms", color: "var(--accent-red)", tail: "1m12s" },
        { gutter: "FAIL", text: "test/migrations.spec.ts · container OOM (exit 137)", color: "var(--accent-red)", tail: "3m41s" },
        { gutter: "SKIP", text: "test/edge-cache.spec.ts · worktree blocked", color: "var(--terminal-muted)", tail: "-" },
      ]
    }

    // events
    return [
      { gutter: "12:06", text: "forge-2 requested merge approval for CS-118", color: "var(--accent-amber)" },
      { gutter: "12:05", text: "forge-3 run failed (exit 137)", color: "var(--accent-red)" },
      { gutter: "12:04", text: "forge-4 rebase blocked on src/pricing/resolver.ts", color: "var(--accent-red)" },
      { gutter: "12:01", text: "forge-1 committed 4 files to agent/atlas/cache-layer", color: "var(--border)" },
      { gutter: "11:58", text: "DEP-77 rollout advanced to 60%", color: "var(--border)" },
      { gutter: "11:52", text: "MSN-241 created by you", color: "var(--terminal-muted)" },
    ]
  }

  const handleTerminalSubmit = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && terminalInput.trim()) {
      setTerminalLog((prev) => [...prev, terminalInput.trim()])
      setTerminalInput("")
    }
  }

  return (
    <div className="border-t border-border bg-card">
      {/* Toggle button when closed */}
      {!open && (
        <button
          onClick={onToggle}
          className="flex w-full items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-secondary"
        >
          <Terminal className="size-3.5" />
          <span>Console</span>
        </button>
      )}

      {/* Drawer content when open */}
      {open && (
        <div
          className="flex flex-col bg-[var(--terminal-background)] transition-[height]"
          style={{ height }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--terminal-muted)]/20 px-3 py-1.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className="relative px-2 py-1 text-[10px] font-medium"
                style={{ color: tab === t.id ? "var(--terminal-foreground)" : "var(--terminal-muted)" }}
              >
                {t.label}
                {tab === t.id && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
                )}
              </button>
            ))}

            <div className="ml-auto flex items-center gap-1">
              {tab === "terminal" && (
                <span className="rounded bg-[#221f18] px-1.5 py-0.5 font-mono text-[9px] text-primary">
                  {scope.toUpperCase()}
                </span>
              )}
              <button
                onClick={onCycleHeight}
                className="rounded p-1 hover:bg-[var(--terminal-muted)]/20"
                title="Resize"
              >
                <NavArrowUp className="size-3" style={{ color: "var(--terminal-muted)" }} />
              </button>
              <button
                onClick={onToggle}
                className="rounded p-1 hover:bg-[var(--terminal-muted)]/20"
                title="Close"
              >
                <Xmark className="size-3" style={{ color: "var(--terminal-muted)" }} />
              </button>
            </div>
          </div>

          {/* Lines */}
          <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
            {getLines().map((line, i) => (
              <div key={i} className="flex gap-2">
                <span style={{ color: line.color === "var(--accent-green)" ? line.color : "var(--terminal-muted)" }} className="w-14 shrink-0 text-right">
                  {line.gutter}
                </span>
                <span style={{ color: line.color }}>{line.text}</span>
                {line.tail && (
                  <span className="ml-auto" style={{ color: "var(--terminal-muted)" }}>
                    {line.tail}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Terminal input */}
          {tab === "terminal" && (
            <div className="flex items-center gap-2 border-t border-[var(--terminal-muted)]/20 px-3 py-2">
              <span className="font-mono text-[11px]" style={{ color: "var(--terminal-muted)" }}>
                {wt?.branch.split("/").pop() || "main"} $
              </span>
              <input
                type="text"
                value={terminalInput}
                onChange={(e) => setTerminalInput(e.target.value)}
                onKeyDown={handleTerminalSubmit}
                className="flex-1 bg-transparent font-mono text-[11px] outline-none"
                style={{ color: "var(--terminal-foreground)" }}
                placeholder="Type a command..."
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
