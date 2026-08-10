"use client"

import { NavArrowDown, NavArrowUp } from "iconoir-react"
import type { Worktree, Changeset, Deployment } from "@/lib/control/types"
import { formatCost } from "@/lib/control/utils"
import { formatTokens } from "@/lib/control/session-usage"

type Props = {
  stats: {
    total: number
    awaiting: number
    failed: number
    spent: number
    tokens?: number
  }
  isOpen: boolean
  onToggle: () => void
  worktrees: Worktree[]
  onSelectWorktree: (id: string) => void
  changesets: Changeset[]
  deployments: Deployment[]
}

const STATE_STYLES: Record<string, { dot: string; border: string; label: string }> = {
  implementing: { dot: "bg-accent-blue", border: "border-border", label: "IMPLEMENTING" },
  approval: { dot: "bg-accent-amber", border: "border-accent-amber/30", label: "READY" },
  failed: { dot: "bg-accent-red", border: "border-accent-red/30", label: "FAILED" },
  blocked: { dot: "bg-accent-red", border: "border-accent-red/30", label: "BLOCKED" },
  paused: { dot: "bg-muted-foreground", border: "border-border", label: "PAUSED" },
  archived: { dot: "bg-muted-foreground/50", border: "border-border", label: "ARCHIVED" },
}

const ATTN_STATES = ["approval", "failed", "blocked"]

type Stats = Props["stats"]

function buildSummaryText(stats: Stats): string {
  const segments = [
    `${stats.total} agents`,
    `${formatCost(stats.spent)} spent`,
  ]
  if (stats.awaiting > 0) segments.splice(1, 0, `${stats.awaiting} awaiting approval`)
  if (stats.failed > 0) segments.splice(segments.length - 1, 0, `${stats.failed} failed`)
  if ((stats.tokens ?? 0) > 0) segments.push(`${formatTokens(stats.tokens ?? 0)} tokens`)
  return segments.join(" · ")
}

export function AgentSummaryStrip({
  stats,
  isOpen,
  onToggle,
  worktrees,
  onSelectWorktree,
  changesets,
  deployments,
}: Props) {
  const summaryText = buildSummaryText(stats)

  // Sort: attention states first
  const sortedWorktrees = [...worktrees]
    .filter((w) => w.state !== "archived")
    .sort((a, b) => {
      const aAttn = ATTN_STATES.includes(a.state) ? 1 : 0
      const bAttn = ATTN_STATES.includes(b.state) ? 1 : 0
      return bAttn - aAttn
    })

  const firstNonAttn = sortedWorktrees.findIndex((w) => !ATTN_STATES.includes(w.state))

  return (
    <div className="border-b border-border bg-card">
      {/* Summary bar */}
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs text-muted-foreground">{summaryText}</span>
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
        >
          {isOpen ? "Hide agents" : "View agents"}
          {isOpen ? (
            <NavArrowUp className="size-3" />
          ) : (
            <NavArrowDown className="size-3" />
          )}
        </button>
      </div>

      {/* Expanded view */}
      {isOpen && (
        <div className="border-t border-border px-4 pb-3 pt-2">
          {/* Section headers */}
          {sortedWorktrees.map((wt, i) => {
            const style = STATE_STYLES[wt.state] || STATE_STYLES.implementing
            const isAttn = ATTN_STATES.includes(wt.state)
            const showHeader = (i === 0 && isAttn) || (i === firstNonAttn && firstNonAttn > 0)
            const headerLabel = i === 0 && isAttn ? "NEEDS YOU" : "WORKING"

            return (
              <div key={wt.id}>
                {showHeader && (
                  <div className={`mb-2 mt-3 first:mt-0 font-mono text-[9px] font-semibold tracking-wider ${isAttn && i === 0 ? "text-accent-amber" : "text-muted-foreground"}`}>
                    {headerLabel}
                  </div>
                )}
                <div
                  onClick={() => onSelectWorktree(wt.id)}
                  className={`mb-2 cursor-pointer rounded-lg border bg-card p-2.5 transition-colors hover:bg-secondary ${style.border}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${style.dot} ${wt.state === "implementing" ? "animate-pulse" : ""}`} />
                    <span className="text-[11px] font-medium">
                      {wt.id} · {wt.agent}
                    </span>
                    <span className={`ml-auto rounded px-1.5 py-0.5 text-[8px] font-semibold ${style.dot.replace("bg-", "bg-").replace("/50", "/10")} ${style.dot.replace("bg-", "text-")}`}>
                      {style.label}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[10px] text-muted-foreground">{wt.task}</div>
                  <div className="mt-1 truncate font-mono text-[9px] text-muted-foreground/70">{wt.action}</div>
                  <div className="mt-1.5 flex gap-3 text-[9px] text-muted-foreground">
                    <span>{wt.files} files</span>
                    <span>{wt.checks}</span>
                    <span>{formatCost(wt.cost)}</span>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Delivery items */}
          {(changesets.length > 0 || deployments.length > 0) && (
            <>
              <div className="mb-2 mt-3 font-mono text-[9px] font-semibold tracking-wider text-muted-foreground">
                DELIVERY
              </div>
              <div className="flex flex-wrap gap-2">
                {changesets.map((cs) => (
                  <div
                    key={cs.id}
                    className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[10px]"
                  >
                    <span className={`size-1.5 rounded-full ${cs.state === "draft" ? "bg-muted-foreground/50" : "bg-accent-green"}`} />
                    <span>{cs.id} · {cs.state}</span>
                    <span className="text-muted-foreground">{cs.checks.split(" ")[0]}</span>
                  </div>
                ))}
                {deployments.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[10px]"
                  >
                    <span className={`size-1.5 rounded-full ${d.health === "healthy" ? "bg-accent-green" : "bg-accent-amber"}`} />
                    <span>{d.id} · {d.env}</span>
                    <span className="text-muted-foreground">{d.age}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
