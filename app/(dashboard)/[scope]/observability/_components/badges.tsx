"use client"

import type { AutomationDispatchEvent } from "@/lib/types"
import type { AutomationCostSource } from "@/lib/observability/automation-run-presentation"
import { formatDispatchOutcome } from "./formatters"

const COST_SOURCE_BADGE_STYLES = {
  gateway:
    "bg-accent-green/10 text-accent-green border-accent-green/20",
  trigger: "bg-muted text-muted-foreground border-border",
  manual: "bg-purple-500/10 text-purple-700 border-purple-500/20 dark:text-purple-300",
  pending:
    "bg-accent-amber/10 text-accent-amber border-accent-amber/20",
} as const

const COST_SOURCE_BADGE_LABELS: Record<
  keyof typeof COST_SOURCE_BADGE_STYLES,
  string
> = {
  gateway: "Reconciled",
  trigger: "Estimated",
  manual: "Manual",
  pending: "Pending",
}

export function CostSourceBadge({
  costSource,
  hasGatewayGenerationId,
}: {
  costSource?: AutomationCostSource
  hasGatewayGenerationId?: boolean
}) {
  // Pending takes priority over trigger/manual: any call with a gateway
  // generation ID that hasn't been reconciled to "gateway" is awaiting
  // reconciliation, regardless of its current estimated cost source.
  const state: keyof typeof COST_SOURCE_BADGE_STYLES | null =
    costSource === "gateway"
      ? "gateway"
      : hasGatewayGenerationId
        ? "pending"
        : costSource === "trigger"
          ? "trigger"
          : costSource === "manual"
            ? "manual"
            : null
  if (!state) return null

  const label = COST_SOURCE_BADGE_LABELS[state]

  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${COST_SOURCE_BADGE_STYLES[state]}`}>
      {label}
    </span>
  )
}

export function StatusBadge({
  status,
  label,
}: {
  status: string
  label?: string
}) {
  const classes = status === "success"
    ? "bg-accent-green/10 text-accent-green border-accent-green/20"
    : status === "failed"
      ? "bg-accent-red/10 text-accent-red border-accent-red/20"
      : status === "cancelled"
        ? "bg-muted text-muted-foreground border-border"
        : status === "running" || status === "streaming"
          ? "bg-accent-blue/10 text-accent-blue border-accent-blue/20"
          : "bg-accent-amber/10 text-accent-amber border-accent-amber/20"

  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${classes}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label ?? status}
    </span>
  )
}

export function PressureOutcomeBadge({ outcome }: { outcome: AutomationDispatchEvent["outcome"] }) {
  const classes = outcome === "started" || outcome === "queued" || outcome === "cancelled" || outcome === "completed"
    ? "bg-accent-green/10 text-accent-green border-accent-green/20"
    : outcome === "suppressed" || outcome === "start_failed" || outcome === "cancel_failed" || outcome === "failed"
      ? "bg-accent-red/10 text-accent-red border-accent-red/20"
    : outcome === "cancel_requested"
        ? "bg-accent-blue/10 text-accent-blue border-accent-blue/20"
        : outcome === "reconciled"
          ? "bg-muted text-muted-foreground border-border"
          : "bg-accent-amber/10 text-accent-amber border-accent-amber/20"

  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${classes}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {formatDispatchOutcome(outcome)}
    </span>
  )
}
