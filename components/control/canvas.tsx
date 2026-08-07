"use client"

import { useState, useCallback, useRef, useMemo } from "react"
import { ZoomIn, ZoomOut, Expand, Refresh } from "iconoir-react"
import type { Mission, Worktree, Changeset, Deployment } from "@/lib/control/types"
import { formatCost } from "@/lib/control/utils"

type Props = {
  mission: Mission | undefined
  worktrees: Worktree[]
  changesets: Changeset[]
  deployments: Deployment[]
  selection: string | null
  onSelectNode: (id: string | null, tab?: string) => void
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
  deployed: { dot: "bg-accent-green", bg: "bg-accent-green/10", fg: "text-accent-green", label: "DEPLOYED" },
  healthy: { dot: "bg-accent-green", bg: "bg-accent-green/10", fg: "text-accent-green", label: "HEALTHY" },
  degraded: { dot: "bg-accent-amber", bg: "bg-accent-amber/10", fg: "text-accent-amber", label: "DEGRADED" },
}

const ENVS = ["preview", "staging", "production"]

type CanvasNode = {
  id: string
  kind: "worktree" | "changeset" | "env"
  x: number
  y: number
  width: number
  height: number
}

export function Canvas({ mission, worktrees, changesets, deployments, selection, onSelectNode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.85)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, panX: 0, panY: 0 })

  // Build node positions
  const nodes = useMemo(() => {
    const result: CanvasNode[] = []
    const posY = [24, 168, 312, 456]

    // Worktrees (left column)
    worktrees.slice(0, 4).forEach((w, i) => {
      result.push({
        id: w.id,
        kind: "worktree",
        x: 250,
        y: posY[i],
        width: 280,
        height: 120,
      })
    })

    // Changesets (middle column)
    const queuedCs = changesets.filter((c) => ["queued", "approved", "merged"].includes(c.state)).slice(0, 2)
    queuedCs.forEach((c, i) => {
      result.push({
        id: c.id,
        kind: "changeset",
        x: 590,
        y: 110 + i * 180,
        width: 200,
        height: 100,
      })
    })

    // Environments (right column)
    ENVS.forEach((env, i) => {
      result.push({
        id: `env-${env}`,
        kind: "env",
        x: 850,
        y: 60 + i * 180,
        width: 220,
        height: 100,
      })
    })

    return result
  }, [worktrees, changesets])

  // Mouse handlers for pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === containerRef.current || (e.target as HTMLElement).closest("[data-canvas-bg]")) {
        setDragging(true)
        setDragStart({ x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y })
      }
    },
    [pan]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragging) {
        setPan({
          x: dragStart.panX + (e.clientX - dragStart.x),
          y: dragStart.panY + (e.clientY - dragStart.y),
        })
      }
    },
    [dragging, dragStart]
  )

  const handleMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

  const zoomIn = useCallback(() => setZoom((z) => Math.min(1.4, z + 0.12)), [])
  const zoomOut = useCallback(() => setZoom((z) => Math.max(0.4, z - 0.12)), [])
  const fitView = useCallback(() => {
    setZoom(0.7)
    setPan({ x: 0, y: 0 })
  }, [])

  const renderWorktreeNode = (wt: Worktree, node: CanvasNode) => {
    const style = STATE_STYLES[wt.state] || STATE_STYLES.archived
    const isSelected = selection === wt.id

    return (
      <div
        key={wt.id}
        onClick={() => onSelectNode(isSelected ? null : wt.id)}
        className={`absolute cursor-pointer rounded-lg border bg-card p-3 transition-shadow ${
          isSelected
            ? "border-primary shadow-lg ring-2 ring-primary/20"
            : "border-border hover:border-primary/50 hover:shadow-md"
        }`}
        style={{
          left: node.x,
          top: node.y,
          width: node.width,
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${style.dot} ${wt.state === "implementing" ? "animate-pulse" : ""}`} />
          <span className="text-[11px] font-medium">{wt.agent} · {wt.harness}</span>
          <span className={`ml-auto rounded px-1.5 py-0.5 text-[8px] font-semibold ${style.bg} ${style.fg}`}>
            {style.label}
          </span>
        </div>

        {/* Task */}
        <div className="mt-2 line-clamp-2 text-[10px] text-muted-foreground">{wt.task}</div>

        {/* Action */}
        <div className="mt-1 truncate font-mono text-[9px] text-muted-foreground/70">{wt.action}</div>

        {/* Metrics */}
        <div className="mt-2 flex items-center gap-3 text-[9px] text-muted-foreground">
          <span>{wt.files} files</span>
          <span>+{wt.ahead}/-{wt.behind}</span>
          <span className={wt.checks === "14/14" ? "text-accent-green" : "text-accent-amber"}>{wt.checks}</span>
          <span>{formatCost(wt.cost)}</span>
        </div>

        {/* Warning */}
        {wt.warn && (
          <div className={`mt-2 truncate text-[9px] ${wt.state === "blocked" || wt.state === "failed" ? "text-accent-red" : "text-accent-amber"}`}>
            {wt.warn}
          </div>
        )}
      </div>
    )
  }

  const renderChangesetNode = (cs: Changeset, node: CanvasNode) => {
    const style = STATE_STYLES[cs.state] || STATE_STYLES.queued
    const isSelected = selection === cs.id

    return (
      <div
        key={cs.id}
        onClick={() => onSelectNode(isSelected ? null : cs.id)}
        className={`absolute cursor-pointer rounded-lg border bg-card p-3 transition-shadow ${
          isSelected
            ? "border-primary shadow-lg ring-2 ring-primary/20"
            : "border-border hover:border-primary/50 hover:shadow-md"
        }`}
        style={{
          left: node.x,
          top: node.y,
          width: node.width,
        }}
      >
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${style.dot}`} />
          <span className="font-mono text-[10px] font-medium">{cs.id}</span>
          <span className={`ml-auto rounded px-1.5 py-0.5 text-[8px] font-semibold ${style.bg} ${style.fg}`}>
            {style.label}
          </span>
        </div>
        <div className="mt-1.5 truncate text-[10px]">{cs.title}</div>
        <div className="mt-1 font-mono text-[9px] text-muted-foreground">{cs.range}</div>
        <div className="mt-1.5 flex gap-3 text-[9px] text-muted-foreground">
          <span>{cs.files} files</span>
          <span className="text-accent-green">+{cs.add}</span>
          <span>{cs.checks.split(" ")[0]}</span>
        </div>
      </div>
    )
  }

  const renderEnvNode = (env: string, node: CanvasNode) => {
    const deployment = deployments.find((d) => d.env === env && d.ws === mission?.ws)
    const style = deployment ? (STATE_STYLES[deployment.health] || STATE_STYLES.healthy) : STATE_STYLES.archived
    const isSelected = selection === `env-${env}`

    return (
      <div
        key={`env-${env}`}
        onClick={() => onSelectNode(isSelected ? null : `env-${env}`)}
        className={`absolute cursor-pointer rounded-lg border bg-secondary/50 p-3 transition-shadow ${
          isSelected
            ? "border-primary shadow-lg ring-2 ring-primary/20"
            : "border-border/50 hover:border-primary/50 hover:shadow-md"
        }`}
        style={{
          left: node.x,
          top: node.y,
          width: node.width,
        }}
      >
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${style.dot}`} />
          <span className="text-[11px] font-semibold uppercase">{env}</span>
          <span className={`ml-auto rounded px-1.5 py-0.5 text-[8px] font-semibold ${style.bg} ${style.fg}`}>
            {style.label}
          </span>
        </div>
        <div className="mt-1.5 text-[10px]">{deployment?.note || "no deployment"}</div>
        <div className="mt-1 font-mono text-[9px] text-muted-foreground">
          {deployment ? `${deployment.id} · ${deployment.commit} · ${deployment.age}` : "idle"}
        </div>
      </div>
    )
  }

  // Render edges as SVG
  const renderEdges = () => {
    const wtNodes = nodes.filter((n) => n.kind === "worktree")
    const csNodes = nodes.filter((n) => n.kind === "changeset")
    const envNodes = nodes.filter((n) => n.kind === "env")

    const paths: React.ReactElement[] = []

    // Base branch to worktrees
    wtNodes.forEach((wt, _i) => {
      const cy = wt.y + 60
      paths.push(
        <path
          key={`base-${wt.id}`}
          d={`M192 ${cy} C 220 ${cy}, 230 ${cy}, ${wt.x} ${cy}`}
          stroke="var(--border)"
          strokeWidth={1.5}
          fill="none"
        />
      )
    })

    // Each changeset connects back to the worktree it came from
    csNodes.forEach((cs) => {
      const source = changesets.find((c) => c.id === cs.id)
      const wtNode = source ? wtNodes.find((n) => n.id === source.worktree) : undefined
      if (!wtNode) return
      paths.push(
        <path
          key={`wt-cs-${cs.id}`}
          d={`M${wtNode.x + wtNode.width} ${wtNode.y + 60} C ${wtNode.x + wtNode.width + 30} ${wtNode.y + 60}, ${cs.x - 30} ${cs.y + 50}, ${cs.x} ${cs.y + 50}`}
          stroke="var(--accent-green)"
          strokeWidth={2}
          fill="none"
        />
      )
    })
    const cs0 = csNodes[0]

    // Changeset to env
    if (cs0 && envNodes[0]) {
      paths.push(
        <path
          key="cs-env"
          d={`M${cs0.x + cs0.width} ${cs0.y + 50} C ${cs0.x + cs0.width + 30} ${cs0.y + 50}, ${envNodes[0].x - 30} ${envNodes[0].y + 50}, ${envNodes[0].x} ${envNodes[0].y + 50}`}
          stroke="var(--accent-green)"
          strokeWidth={2}
          fill="none"
        />
      )
    }

    return (
      <svg className="pointer-events-none absolute inset-0" style={{ width: 1200, height: 700 }}>
        {paths}
      </svg>
    )
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-background">
      {/* Controls */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
        <button onClick={zoomIn} className="rounded p-1.5 hover:bg-secondary" title="Zoom in">
          <ZoomIn className="size-4 text-muted-foreground" />
        </button>
        <button onClick={zoomOut} className="rounded p-1.5 hover:bg-secondary" title="Zoom out">
          <ZoomOut className="size-4 text-muted-foreground" />
        </button>
        <button onClick={fitView} className="rounded p-1.5 hover:bg-secondary" title="Fit to view">
          <Expand className="size-4 text-muted-foreground" />
        </button>
        <span className="px-2 font-mono text-[10px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
      </div>

      {/* Base branch node */}
      <div className="absolute left-4 top-4 z-10 rounded-lg border border-border bg-card p-3 shadow-sm" style={{ width: 180 }}>
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-accent-green" />
          <span className="font-mono text-[11px] font-semibold">main</span>
        </div>
        <div className="mt-1 text-[9px] text-muted-foreground">
          {worktrees.length} worktrees forked
        </div>
        <button className="mt-2 flex items-center gap-1 rounded border border-border px-2 py-1 text-[9px] hover:bg-secondary">
          <Refresh className="size-3" />
          Sync
        </button>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        data-canvas-bg
        className="h-full w-full"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            width: 1200,
            height: 700,
          }}
        >
          {renderEdges()}
          {nodes.map((node) => {
            if (node.kind === "worktree") {
              const wt = worktrees.find((w) => w.id === node.id)
              return wt ? renderWorktreeNode(wt, node) : null
            }
            if (node.kind === "changeset") {
              const cs = changesets.find((c) => c.id === node.id)
              return cs ? renderChangesetNode(cs, node) : null
            }
            if (node.kind === "env") {
              const env = node.id.replace("env-", "")
              return renderEnvNode(env, node)
            }
            return null
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 flex items-center gap-4 rounded-lg border border-border bg-card px-3 py-2 text-[9px]">
        <div className="flex items-center gap-1.5">
          <div className="h-0.5 w-4 bg-border" />
          <span className="text-muted-foreground">FORK</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-0.5 w-4 bg-accent-amber" style={{ strokeDasharray: "4 4" }} />
          <span className="text-muted-foreground">FILE OVERLAP</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-0.5 w-4 bg-accent-red" style={{ strokeDasharray: "3 5" }} />
          <span className="text-muted-foreground">CONFLICT</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-0.5 w-4 bg-accent-green" />
          <span className="text-muted-foreground">INTEGRATE / DEPLOY</span>
        </div>
      </div>
    </div>
  )
}
