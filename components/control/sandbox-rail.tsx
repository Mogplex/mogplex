"use client"

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import {
  Cube,
  GitBranch,
  MoreVert,
  NavArrowDown,
  Page,
  SidebarCollapse,
  SidebarExpand,
  Terminal,
} from "iconoir-react"
import type { Changeset, Worktree } from "@/lib/control/types"

type Props = {
  worktrees: Worktree[]
  changesets: Changeset[]
}

type SectionId = "files" | "diff" | "terminal"

const RAIL_WIDTH_KEY = "mogplex.sandboxRail.width"
const RAIL_COLLAPSED_KEY = "mogplex.sandboxRail.collapsed"
const DEFAULT_RAIL_WIDTH = 496
const MIN_RAIL_WIDTH = 400
const MAX_RAIL_WIDTH = 720

function clampRailWidth(value: number) {
  return Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, value))
}

function RailSection({
  id,
  title,
  icon,
  open,
  onToggle,
  children,
  bordered = true,
}: {
  id: SectionId
  title: string
  icon?: ReactNode
  open: boolean
  onToggle: (id: SectionId) => void
  children: ReactNode
  bordered?: boolean
}) {
  return (
    <section className={`space-y-3 ${bordered ? "border-t border-border pt-4" : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`sandbox-rail-${id}`}
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between rounded-md text-left text-sm font-semibold outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
        <NavArrowDown
          className={`size-4 text-muted-foreground transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>
      {open ? <div id={`sandbox-rail-${id}`}>{children}</div> : null}
    </section>
  )
}

function FileTree({ worktree }: { worktree: Worktree | undefined }) {
  const repo = worktree?.repo || "workspace"
  const files = worktree
    ? [
        "app/page.tsx",
        "components/agent-panel.tsx",
        "lib/sandbox/client.ts",
        "tests/control-flow.test.ts",
      ]
    : []

  if (!worktree) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-input px-3 py-8 text-center text-xs text-muted-foreground">
        No sandbox running.
      </div>
    )
  }

  return (
    <div className="space-y-1 font-mono text-xs">
      <p className="pb-1 font-sans text-[11px] text-muted-foreground">
        Preview data until live file sync is attached.
      </p>
      <div className="flex h-6 items-center gap-2 text-secondary-foreground">
        <NavArrowDown className="size-3.5" />
        <span>{repo}/</span>
      </div>
      {files.map((file, index) => (
        <button
          key={file}
          type="button"
          aria-disabled="true"
          className={`flex h-6 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted ${
            index === 1 ? "bg-accent text-foreground" : "text-secondary-foreground"
          }`}
        >
          <Page className="size-3.5 shrink-0" />
          <span className="truncate">{file}</span>
        </button>
      ))}
    </div>
  )
}

function DiffPreview({ changeset }: { changeset: Changeset | undefined }) {
  if (!changeset) {
    return (
      <div className="rounded-lg bg-input p-3 font-mono text-xs text-muted-foreground">
        diff --git waits for the next agent change.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg bg-input p-3 font-mono text-xs leading-5">
      <div className="font-sans text-[11px] text-muted-foreground">
        Preview diff until live changesets are attached.
      </div>
      <div className="text-muted-foreground">
        diff --git a/{changeset.title} b/{changeset.title}
      </div>
      <div className="text-muted-foreground">@@ -1,4 +1,8 @@</div>
      <div className="text-secondary-foreground"> import &#123; run &#125; from "./agent"</div>
      <div className="border-l-2 border-accent-green bg-accent-green/10 pl-2 text-[#86efac]">
        + await run.withSandbox()
      </div>
      <div className="border-l-2 border-accent-red bg-accent-red/10 pl-2 text-[#fca5a5]">
        - await run.local()
      </div>
    </div>
  )
}

function TerminalPreview({ worktree }: { worktree: Worktree | undefined }) {
  const path = worktree ? `~/workspace/${worktree.repo}` : "~/workspace"

  return (
    <div className="rounded-lg bg-input p-3 font-mono text-xs leading-5">
      <div>
        <span className="text-accent-blue">acme@sandbox:{path}$</span>{" "}
        <span className="text-foreground">{worktree ? "pnpm test" : "waiting"}</span>
      </div>
      {worktree ? (
        <>
          <div className="text-muted-foreground">Preview output.</div>
          <div className="text-accent-green">PASS tests/control-flow.test.ts</div>
          <div className="text-accent-green">Tests: {worktree.checks}</div>
        </>
      ) : (
        <div className="text-muted-foreground">No terminal session attached.</div>
      )}
      <div className="mt-1 inline-block h-4 w-2 animate-pulse bg-foreground" />
    </div>
  )
}

export function SandboxRail({ worktrees, changesets }: Props) {
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    files: true,
    diff: true,
    terminal: true,
  })
  const [width, setWidth] = useState(DEFAULT_RAIL_WIDTH)
  const [collapsed, setCollapsed] = useState(false)
  const [resizing, setResizing] = useState(false)
  const activePointerId = useRef<number | null>(null)
  const railRef = useRef<HTMLElement | null>(null)
  const activeWorktree = worktrees.find((w) => w.state !== "archived")
  const activeChangeset = activeWorktree
    ? changesets.find((c) => c.worktree === activeWorktree.id)
    : undefined
  const toggleSection = (id: SectionId) => {
    setOpenSections((current) => ({ ...current, [id]: !current[id] }))
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedWidth = Number(window.localStorage.getItem(RAIL_WIDTH_KEY))
      const storedCollapsed = window.localStorage.getItem(RAIL_COLLAPSED_KEY)
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        setWidth(clampRailWidth(storedWidth))
      }
      if (storedCollapsed === "true") {
        setCollapsed(true)
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
      className="app-live-rail relative hidden shrink-0 overflow-y-auto border-l border-border xl:block"
      data-resizing={resizing ? "true" : "false"}
      style={{ width }}
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
      <div className="space-y-4 p-4">
        <div className="flex gap-1">
          {["Sandbox", "Diffs", "Outputs", "Terminal"].map((tab, index) => (
            <button
              key={tab}
              type="button"
              disabled
              aria-label={`${tab} tab preview`}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                index === 0
                  ? "bg-accent text-foreground"
                  : "text-secondary-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="grid size-10 place-items-center rounded-lg bg-secondary">
            <Cube className="size-5" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">
                {activeWorktree?.sandbox || "sandbox"}
              </span>
              <span className="text-xs text-accent-blue">
                {activeWorktree ? "Running" : "Idle"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {activeWorktree ? `Started ${activeWorktree.elapsed}` : "No active run"}
            </div>
          </div>
          <button
            type="button"
            disabled
            aria-label={activeWorktree ? "Stop sandbox preview" : "Start sandbox preview"}
            className="ml-auto rounded-lg border border-accent-red/40 px-3 py-1.5 text-sm text-accent-red opacity-60"
          >
            {activeWorktree ? "Stop" : "Start"}
          </button>
          <button
            type="button"
            disabled
            aria-label="Sandbox rail actions preview"
            className="grid size-8 place-items-center rounded-lg text-muted-foreground opacity-60"
          >
            <MoreVert className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Collapse sandbox rail"
            title="Collapse sandbox rail"
            onClick={toggleCollapsed}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <SidebarCollapse className="size-4 rotate-180" />
          </button>
        </div>

        <RailSection
          id="files"
          title="Files"
          open={openSections.files}
          onToggle={toggleSection}
          bordered={false}
        >
          <FileTree worktree={activeWorktree} />
        </RailSection>

        <RailSection
          id="diff"
          title="Diff"
          icon={<GitBranch className="size-4" />}
          open={openSections.diff}
          onToggle={toggleSection}
        >
          <DiffPreview changeset={activeChangeset} />
        </RailSection>

        <RailSection
          id="terminal"
          title="Terminal"
          icon={<Terminal className="size-4" />}
          open={openSections.terminal}
          onToggle={toggleSection}
        >
          <TerminalPreview worktree={activeWorktree} />
        </RailSection>
      </div>
    </aside>
  )
}
