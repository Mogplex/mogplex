"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Xmark, PlaySolid, PauseSolid, RefreshDouble, GitFork, ArrowSeparateVertical, ArrowUp, Archive } from "iconoir-react"
import type { Mission, Worktree, Changeset, Deployment, TimelineEvent } from "@/lib/control/types"
import { formatCost } from "@/lib/control/utils"

type Props = {
  selection: string
  tab: string
  onTabChange: (tab: string) => void
  onClose: () => void
  worktrees: Worktree[]
  changesets: Changeset[]
  deployments: Deployment[]
  mission: Mission | undefined
  onPatchWorktree: (id: string, patch: Partial<Worktree>) => void
  onPushEvent: (event: TimelineEvent) => void
  onOpenDrawer: (tab: "terminal" | "logs" | "tests" | "events") => void
}

const STATE_STYLES: Record<string, { dot: string; bg: string; fg: string; label: string }> = {
  implementing: { dot: "bg-accent-blue", bg: "bg-accent-blue/10", fg: "text-accent-blue", label: "IMPLEMENTING" },
  approval: { dot: "bg-accent-amber", bg: "bg-accent-amber/10", fg: "text-accent-amber", label: "READY" },
  failed: { dot: "bg-accent-red", bg: "bg-accent-red/10", fg: "text-accent-red", label: "FAILED" },
  blocked: { dot: "bg-accent-red", bg: "bg-accent-red/10", fg: "text-accent-red", label: "BLOCKED" },
  paused: { dot: "bg-muted-foreground", bg: "bg-muted/50", fg: "text-muted-foreground", label: "PAUSED" },
  archived: { dot: "bg-muted-foreground/50", bg: "bg-muted/30", fg: "text-muted-foreground", label: "ARCHIVED" },
  queued: { dot: "bg-accent-amber", bg: "bg-accent-amber/10", fg: "text-accent-amber", label: "QUEUED" },
  merged: { dot: "bg-accent-green", bg: "bg-accent-green/10", fg: "text-accent-green", label: "MERGED" },
  healthy: { dot: "bg-accent-green", bg: "bg-accent-green/10", fg: "text-accent-green", label: "HEALTHY" },
  degraded: { dot: "bg-accent-amber", bg: "bg-accent-amber/10", fg: "text-accent-amber", label: "DEGRADED" },
}

const INSPECTOR_WIDTH_KEY = "mogplex.controlInspector.width"
const DEFAULT_INSPECTOR_WIDTH = 320
const MIN_INSPECTOR_WIDTH = 280
const MAX_INSPECTOR_WIDTH = 560

function clampInspectorWidth(value: number) {
  return Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, value))
}

export function Inspector({
  selection,
  tab,
  onTabChange,
  onClose,
  worktrees,
  changesets,
  deployments,
  mission,
  onPatchWorktree,
  onPushEvent: _onPushEvent,
  onOpenDrawer,
}: Props) {
  const isWorktree = selection.startsWith("wt-")
  const isChangeset = selection.startsWith("CS-")
  const isEnv = selection.startsWith("env-")

  const worktree = isWorktree ? worktrees.find((w) => w.id === selection) : null
  const changeset = isChangeset ? changesets.find((c) => c.id === selection) : null
  const env = isEnv ? selection.replace("env-", "") : null
  const deployment = isEnv ? deployments.find((d) => d.env === env && d.ws === mission?.ws) : null
  const [width, setWidth] = useState(DEFAULT_INSPECTOR_WIDTH)
  const [resizing, setResizing] = useState(false)
  const activePointerId = useRef<number | null>(null)
  const asideRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedWidth = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY))
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        setWidth(clampInspectorWidth(storedWidth))
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
        asideRef.current?.getBoundingClientRect().right ?? window.innerWidth
      const nextWidth = clampInspectorWidth(rightEdge - event.clientX)
      setWidth(nextWidth)
      window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(nextWidth))
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
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const direction = event.key === "ArrowLeft" ? 16 : -16
    setWidth((current) => {
      const next = clampInspectorWidth(current + direction)
      window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(next))
      return next
    })
  }

  const style = worktree
    ? STATE_STYLES[worktree.state]
    : changeset
    ? STATE_STYLES[changeset.state]
    : deployment
    ? STATE_STYLES[deployment.health]
    : STATE_STYLES.archived

  const tabs = isWorktree
    ? ["summary", "conversation", "files", "diff", "terminal", "trace", "sandbox", "actions"]
    : isChangeset
    ? ["summary", "diff", "checks", "actions"]
    : ["summary", "deployments", "logs", "actions"]

  const renderSummary = () => {
    if (worktree) {
      return (
        <div className="space-y-4">
          <Section title="WORKTREE">
            <Row label="Agent" value={worktree.agent} />
            <Row label="Harness" value={worktree.harness} />
            <Row label="Branch" value={worktree.branch} valueClass="text-primary font-mono" />
            <Row label="State" value={worktree.state} valueClass={style.fg} />
            <Row label="Current action" value={worktree.action} />
            <Row label="Elapsed" value={worktree.elapsed} />
            <Row label="Files changed" value={String(worktree.files)} />
            <Row label="Ahead / behind" value={`${worktree.ahead} / ${worktree.behind}`} valueClass={worktree.behind ? "text-accent-amber" : ""} />
            <Row label="Checks" value={worktree.checks} valueClass={worktree.checks === "14/14" ? "text-accent-green" : "text-accent-amber"} />
            <Row label="Cost" value={formatCost(worktree.cost)} />
            <Row label="Context used" value={`${worktree.ctx}%`} valueClass={worktree.ctx > 80 ? "text-accent-amber" : ""} />
            <Row label="Sandbox" value={worktree.sandbox} />
            <Row label="Risk" value={worktree.risk} valueClass={worktree.risk === "high" ? "text-accent-red" : worktree.risk === "medium" ? "text-accent-amber" : "text-accent-green"} />
          </Section>
          {worktree.warn && (
            <Section title="ATTENTION">
              <p className="text-xs text-accent-red">{worktree.warn}</p>
            </Section>
          )}
          <Section title="QUICK ACTIONS">
            <div className="flex flex-wrap gap-2">
              <ActionButton label="Steer" primary onClick={() => {}} />
              <ActionButton label="Inspect diff" onClick={() => onTabChange("diff")} />
              <ActionButton label="All actions" onClick={() => onTabChange("actions")} />
            </div>
          </Section>
        </div>
      )
    }

    if (changeset) {
      return (
        <div className="space-y-4">
          <Section title="CHANGE SET">
            <Row label="Mission" value={changeset.mission} valueClass="text-primary font-mono" />
            <Row label="Worktree" value={changeset.worktree} valueClass="text-primary font-mono" />
            <Row label="Commits" value={String(changeset.commits)} />
            <Row label="Range" value={changeset.range} valueClass="font-mono" />
            <Row label="Files" value={`${changeset.files} (+${changeset.add}/-${changeset.del})`} />
            <Row label="Review" value={changeset.review} />
            <Row label="Checks" value={changeset.checks} valueClass={changeset.checks.includes("pass") ? "text-accent-green" : "text-accent-amber"} />
            <Row label="Conflicts" value={String(changeset.conflicts)} valueClass={changeset.conflicts ? "text-accent-red" : "text-accent-green"} />
            <Row label="Target" value={changeset.target} />
            <Row label="Risk" value={changeset.risk} valueClass="text-accent-amber" />
          </Section>
        </div>
      )
    }

    if (isEnv) {
      return (
        <div className="space-y-4">
          <Section title="ENVIRONMENT">
            <Row label="Environment" value={env || ""} />
            <Row label="Workspace" value={mission?.ws.replace("ws-", "") || ""} />
            <Row label="Deployment" value={deployment?.id || "-"} valueClass={deployment ? "text-primary font-mono" : ""} />
            <Row label="Commit" value={deployment?.commit || "-"} />
            <Row label="Age" value={deployment?.age || "-"} />
            <Row label="Health" value={deployment?.health || "idle"} valueClass={deployment?.health === "healthy" ? "text-accent-green" : "text-accent-amber"} />
            <Row label="Change set" value={deployment?.changeset || "-"} valueClass="text-primary font-mono" />
          </Section>
          <Section title="NOTE">
            <p className="text-xs text-muted-foreground">{deployment?.note || "No deployment in this environment yet."}</p>
          </Section>
        </div>
      )
    }

    return null
  }

  const renderActions = () => {
    if (worktree) {
      return (
        <div className="space-y-4">
          <Section title="EXECUTION">
            <div className="flex flex-wrap gap-2">
              <ActionButton label="Steer" primary onClick={() => {}} Icon={PlaySolid} />
              {worktree.state === "paused" ? (
                <ActionButton label="Resume" onClick={() => onPatchWorktree(worktree.id, { state: "implementing", action: "resumed" })} Icon={PlaySolid} />
              ) : (
                <ActionButton label="Pause" onClick={() => onPatchWorktree(worktree.id, { state: "paused", action: "paused by you" })} Icon={PauseSolid} />
              )}
              <ActionButton label="Retry run" onClick={() => onPatchWorktree(worktree.id, { state: "implementing", action: "retrying..." })} Icon={RefreshDouble} />
              <ActionButton label="Fork approach" onClick={() => {}} Icon={GitFork} />
              <ActionButton label="Compare" onClick={() => {}} Icon={ArrowSeparateVertical} />
              <ActionButton label="Stop" danger onClick={() => onPatchWorktree(worktree.id, { state: "archived", action: "stopped by you" })} />
            </div>
          </Section>
          <Section title="GIT">
            <div className="flex flex-wrap gap-2">
              <ActionButton label="Rebase onto main" onClick={() => onPatchWorktree(worktree.id, { behind: 0, action: "rebased onto main", state: worktree.state === "blocked" ? "implementing" : worktree.state })} />
              <ActionButton label="Promote to integration" primary onClick={() => {}} Icon={ArrowUp} />
              <ActionButton label="Archive" danger onClick={() => onPatchWorktree(worktree.id, { state: "archived", action: "archived" })} Icon={Archive} />
            </div>
          </Section>
        </div>
      )
    }

    if (changeset) {
      return (
        <div className="space-y-4">
          <Section title="CHANGE SET ACTIONS">
            <div className="flex flex-wrap gap-2">
              <ActionButton label={`Merge into ${changeset.target}`} primary onClick={() => {}} />
              <ActionButton label="Deploy to staging" onClick={() => {}} />
              <ActionButton label="Request changes" onClick={() => {}} />
            </div>
          </Section>
        </div>
      )
    }

    if (isEnv) {
      return (
        <div className="space-y-4">
          <Section title="ENVIRONMENT ACTIONS">
            <div className="flex flex-wrap gap-2">
              <ActionButton label="Promote to production" primary onClick={() => {}} />
              <ActionButton label="Redeploy" onClick={() => {}} />
              <ActionButton label="Hold rollout" onClick={() => {}} />
              <ActionButton label="Roll back" danger onClick={() => {}} />
            </div>
          </Section>
        </div>
      )
    }

    return null
  }

  const renderTerminal = () => {
    if (!worktree) return null
    return (
      <div className="space-y-3">
        <Section title="SANDBOX SHELL">
          <p className="text-xs text-muted-foreground">No terminal output captured yet.</p>
        </Section>
        <button
          onClick={() => onOpenDrawer("terminal")}
          className="rounded border border-border px-2.5 py-1 text-[10px] font-medium hover:bg-secondary"
        >
          Open in drawer
        </button>
      </div>
    )
  }

  const renderTabContent = () => {
    switch (tab) {
      case "summary":
        return renderSummary()
      case "actions":
        return renderActions()
      case "terminal":
        return renderTerminal()
      case "diff":
        return (
          <Section title="UNIFIED DIFF">
            <p className="text-xs text-muted-foreground">No diff captured yet.</p>
          </Section>
        )
      default:
        return (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            {tab.charAt(0).toUpperCase() + tab.slice(1)} tab content
          </div>
        )
    }
  }

  return (
    <aside
      ref={asideRef}
      className="relative flex shrink-0 flex-col border-l border-border bg-card"
      data-resizing={resizing ? "true" : "false"}
      style={{ width }}
    >
      <div
        role="separator"
        aria-label="Resize inspector"
        aria-orientation="vertical"
        aria-valuemin={MIN_INSPECTOR_WIDTH}
        aria-valuemax={MAX_INSPECTOR_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onKeyDown={resizeFromKeyboard}
        onDoubleClick={() => {
          setWidth(DEFAULT_INSPECTOR_WIDTH)
          window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(DEFAULT_INSPECTOR_WIDTH))
        }}
        onPointerDown={(event) => {
          activePointerId.current = event.pointerId
          setResizing(true)
        }}
        className="app-panel-resizer app-panel-resizer-left absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize touch-none outline-none"
      />
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className={`size-2 rounded-full ${style.dot}`} />
        <span className="font-mono text-[11px] font-semibold">{selection}</span>
        <span className={`ml-auto rounded px-1.5 py-0.5 text-[8px] font-semibold ${style.bg} ${style.fg}`}>
          {style.label}
        </span>
        <button onClick={onClose} className="rounded p-0.5 hover:bg-secondary">
          <Xmark className="size-4 text-muted-foreground" />
        </button>
      </div>

      {/* Subtitle */}
      {worktree && (
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs">{worktree.task}</p>
          <p className="mt-1 font-mono text-[9px] text-muted-foreground">
            {worktree.branch} · {worktree.harness} · {worktree.elapsed}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0.5 overflow-x-auto border-b border-border px-2 py-1">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={`relative whitespace-nowrap px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
              tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
            {tab === t && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">{renderTabContent()}</div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueClass || "text-foreground"}>{value}</span>
    </div>
  )
}

type ActionButtonProps = {
  label: string
  onClick: () => void
  primary?: boolean
  danger?: boolean
  Icon?: typeof PlaySolid
}

function ActionButton({ label, onClick, primary, danger, Icon }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
        primary
          ? "bg-primary text-primary-foreground hover:bg-brand-accent-hover"
          : danger
          ? "border border-accent-red/30 bg-accent-red/5 text-accent-red hover:bg-accent-red/10"
          : "border border-border hover:bg-secondary"
      }`}
    >
      {Icon && <Icon className="size-3" />}
      {label}
    </button>
  )
}
