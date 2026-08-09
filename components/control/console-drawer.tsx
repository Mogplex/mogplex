"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
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

const DRAWER_HEIGHT_KEY = "mogplex.consoleDrawer.height"
const MIN_DRAWER_HEIGHT = 140
const MAX_DRAWER_HEIGHT = 520

function clampDrawerHeight(value: number) {
  return Math.min(MAX_DRAWER_HEIGHT, Math.max(MIN_DRAWER_HEIGHT, value))
}

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
  const [liveHeight, setLiveHeight] = useState(height)
  const [resizing, setResizing] = useState(false)
  const activePointerId = useRef<number | null>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedHeight = Number(window.localStorage.getItem(DRAWER_HEIGHT_KEY))
      if (Number.isFinite(storedHeight) && storedHeight > 0) {
        setLiveHeight(clampDrawerHeight(storedHeight))
      } else {
        setLiveHeight(height)
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [height])

  useEffect(() => {
    if (!resizing) return

    const onPointerMove = (event: PointerEvent) => {
      if (
        activePointerId.current !== null &&
        event.pointerId !== activePointerId.current
      ) {
        return
      }
      const nextHeight = clampDrawerHeight(window.innerHeight - event.clientY)
      setLiveHeight(nextHeight)
      window.localStorage.setItem(DRAWER_HEIGHT_KEY, String(nextHeight))
    }
    const stopResizing = () => {
      activePointerId.current = null
      setResizing(false)
    }

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", stopResizing)
    window.addEventListener("pointercancel", stopResizing)
    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", stopResizing)
      window.removeEventListener("pointercancel", stopResizing)
    }
  }, [resizing])

  const resizeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    event.preventDefault()
    const direction = event.key === "ArrowUp" ? 16 : -16
    setLiveHeight((current) => {
      const next = clampDrawerHeight(current + direction)
      window.localStorage.setItem(DRAWER_HEIGHT_KEY, String(next))
      return next
    })
  }

  // Get active worktree for terminal context
  const wt = (selection?.startsWith("wt-") ? getWorktree(selection) : undefined) || worktrees[0]
  const scope = wt?.id ?? "no worktree"

  // Logs, tests, and events have no live data source yet; only the terminal
  // shows anything, and only what the user has typed this session.
  const getLines = (): Line[] => {
    if (tab === "terminal") {
      return terminalLog.map((l) => ({ gutter: "$", text: l, color: "var(--terminal-foreground)" }))
    }
    return []
  }

  const EMPTY_MESSAGES: Record<Tab, string> = {
    terminal: "No commands run yet.",
    logs: "No logs yet.",
    tests: "No test runs yet.",
    events: "No events yet.",
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
          className="relative flex flex-col bg-[var(--terminal-background)] transition-[height]"
          data-resizing={resizing ? "true" : "false"}
          style={{ height: liveHeight }}
        >
          <div
            role="separator"
            aria-label="Resize console"
            aria-orientation="horizontal"
            aria-valuemin={MIN_DRAWER_HEIGHT}
            aria-valuemax={MAX_DRAWER_HEIGHT}
            aria-valuenow={Math.round(liveHeight)}
            tabIndex={0}
            onKeyDown={resizeFromKeyboard}
            onDoubleClick={() => {
              setLiveHeight(height)
              window.localStorage.setItem(DRAWER_HEIGHT_KEY, String(height))
            }}
            onPointerDown={(event) => {
              activePointerId.current = event.pointerId
              setResizing(true)
            }}
            className="app-panel-resizer app-panel-resizer-top absolute inset-x-0 top-0 z-30 h-2 cursor-row-resize touch-none outline-none"
          />
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
            {getLines().length === 0 && (
              <div className="py-2" style={{ color: "var(--terminal-muted)" }}>
                {EMPTY_MESSAGES[tab]}
              </div>
            )}
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
