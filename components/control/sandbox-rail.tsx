"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import {
  Box,
  GitCompare,
  InputOutput,
  SidebarCollapse,
  SidebarExpand,
  Terminal,
} from "iconoir-react"
import type { UIMessage } from "ai"
import { collectFileMutations } from "@/lib/control/activity-stream"
import { collectControlArtifacts } from "./artifact-side-panel-model"
import { SandboxPanel } from "./sandbox-panel"
import { TerminalStream } from "./terminal-stream"

type Props = {
  messages: UIMessage[]
  streaming: boolean
}

type RailTab = "sandbox" | "diffs" | "outputs" | "terminal"

const RAIL_WIDTH_KEY = "mogplex.sandboxRail.width"
const RAIL_COLLAPSED_KEY = "mogplex.sandboxRail.collapsed"
const RAIL_TAB_KEY = "mogplex.sandboxRail.tab"
const DEFAULT_RAIL_WIDTH = 496
const MIN_RAIL_WIDTH = 400
const MAX_RAIL_WIDTH = 720

const TABS: ReadonlyArray<{
  id: RailTab
  label: string
  Icon: typeof Box
}> = [
  { id: "sandbox", label: "Sandbox", Icon: Box },
  { id: "diffs", label: "Diffs", Icon: GitCompare },
  { id: "outputs", label: "Outputs", Icon: InputOutput },
  { id: "terminal", label: "Terminal", Icon: Terminal },
]

function clampRailWidth(value: number) {
  return Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, value))
}

function isRailTab(value: string | null): value is RailTab {
  return TABS.some((tab) => tab.id === value)
}

function DiffsPanel({ messages }: { messages: UIMessage[] }) {
  const mutations = useMemo(() => collectFileMutations(messages), [messages])

  if (mutations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-input px-3 py-8 text-center text-xs text-muted-foreground">
        No file changes yet. Edits the agent makes show up here.
      </div>
    )
  }

  return (
    <div className="space-y-1 font-mono text-xs">
      {mutations.map((mutation) => (
        <div
          key={mutation.id}
          className="flex h-7 items-center gap-2 rounded-md px-2"
        >
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              mutation.state === "done"
                ? "bg-accent-green"
                : mutation.state === "failed"
                  ? "bg-accent-red"
                  : "bg-accent-blue animate-pulse"
            }`}
          />
          <span className="text-muted-foreground shrink-0">{mutation.tool}</span>
          <span className="truncate text-foreground">{mutation.path}</span>
        </div>
      ))}
    </div>
  )
}

function OutputsPanel({ messages }: { messages: UIMessage[] }) {
  const artifacts = useMemo(() => collectControlArtifacts(messages), [messages])

  if (artifacts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-input px-3 py-8 text-center text-xs text-muted-foreground">
        No outputs yet. Documents and files the agent produces show up here.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {artifacts.map((artifact) => (
        <div
          key={artifact.id}
          className="rounded-lg border border-border bg-card p-3"
        >
          <div className="truncate text-xs font-semibold">{artifact.title}</div>
          <div className="text-[11px] text-muted-foreground">
            {artifact.description}
          </div>
          {artifact.kind === "file" && artifact.file ? (
            <a
              href={artifact.file.url}
              download={artifact.file.filename}
              className="mt-1 inline-block text-[11px] text-accent-blue hover:underline"
            >
              Download {artifact.file.filename ?? "file"}
            </a>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function SandboxRail({ messages, streaming }: Props) {
  const [tab, setTab] = useState<RailTab>("terminal")
  const [width, setWidth] = useState(DEFAULT_RAIL_WIDTH)
  const [collapsed, setCollapsed] = useState(false)
  const [resizing, setResizing] = useState(false)
  const activePointerId = useRef<number | null>(null)
  const railRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedWidth = Number(window.localStorage.getItem(RAIL_WIDTH_KEY))
      const storedCollapsed = window.localStorage.getItem(RAIL_COLLAPSED_KEY)
      const storedTab = window.localStorage.getItem(RAIL_TAB_KEY)
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        setWidth(clampRailWidth(storedWidth))
      }
      if (storedCollapsed === "true") {
        setCollapsed(true)
      }
      if (isRailTab(storedTab)) {
        setTab(storedTab)
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!resizing) return

    const onPointerMove = (event: PointerEvent) => {
      if (
        activePointerId.current !== null &&
        event.pointerId !== activePointerId.current
      ) {
        return
      }
      const rightEdge =
        railRef.current?.getBoundingClientRect().right ?? window.innerWidth
      const nextWidth = clampRailWidth(rightEdge - event.clientX)
      setWidth(nextWidth)
      setCollapsed(false)
      window.localStorage.setItem(RAIL_WIDTH_KEY, String(nextWidth))
      window.localStorage.setItem(RAIL_COLLAPSED_KEY, "false")
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

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current
      window.localStorage.setItem(RAIL_COLLAPSED_KEY, String(next))
      return next
    })
  }

  const selectTab = (next: RailTab) => {
    setTab(next)
    window.localStorage.setItem(RAIL_TAB_KEY, next)
  }

  const resizeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const direction = event.key === "ArrowLeft" ? 16 : -16
    setWidth((current) => {
      const next = clampRailWidth(current + direction)
      window.localStorage.setItem(RAIL_WIDTH_KEY, String(next))
      return next
    })
  }

  if (collapsed) {
    return (
      <aside className="app-live-rail hidden w-11 shrink-0 border-l border-border xl:flex">
        <button
          type="button"
          aria-label="Expand sandbox rail"
          title="Expand sandbox rail"
          onClick={toggleCollapsed}
          className="grid h-full w-full place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <SidebarExpand className="size-4 rotate-180" />
        </button>
      </aside>
    )
  }

  return (
    <aside
      ref={railRef}
      className="app-live-rail relative hidden shrink-0 border-l border-border xl:flex xl:flex-col"
      data-resizing={resizing ? "true" : "false"}
      style={{ width }}
      aria-label="Live rail"
    >
      <div
        role="separator"
        aria-label="Resize sandbox rail"
        aria-orientation="vertical"
        aria-valuemin={MIN_RAIL_WIDTH}
        aria-valuemax={MAX_RAIL_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onKeyDown={resizeFromKeyboard}
        onDoubleClick={() => {
          setWidth(DEFAULT_RAIL_WIDTH)
          window.localStorage.setItem(RAIL_WIDTH_KEY, String(DEFAULT_RAIL_WIDTH))
        }}
        onPointerDown={(event) => {
          activePointerId.current = event.pointerId
          setResizing(true)
        }}
        className="app-panel-resizer app-panel-resizer-left absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize touch-none outline-none"
      />
      <div className="flex items-center gap-1 p-4 pb-0">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            aria-label={`${label} tab`}
            onClick={() => selectTab(id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              tab === id
                ? "bg-accent text-foreground"
                : "text-secondary-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.5} />
            {label}
          </button>
        ))}
        <button
          type="button"
          aria-label="Collapse sandbox rail"
          title="Collapse sandbox rail"
          onClick={toggleCollapsed}
          className="ml-auto grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <SidebarCollapse className="size-4 rotate-180" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        {tab === "sandbox" ? <SandboxPanel /> : null}
        {tab === "diffs" ? <DiffsPanel messages={messages} /> : null}
        {tab === "outputs" ? <OutputsPanel messages={messages} /> : null}
        {tab === "terminal" ? (
          <TerminalStream messages={messages} streaming={streaming} />
        ) : null}
      </div>
    </aside>
  )
}
