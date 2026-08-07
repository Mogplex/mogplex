"use client"

import type { ReactNode } from "react"
import type { FlowAgentNodeRole } from "@/lib/types"

export function roleBadgeTone(role: FlowAgentNodeRole) {
  switch (role) {
    case "edit":
      return "border-accent-green/20 bg-accent-green/[0.08] text-accent-green"
    case "triage":
      return "border-accent-violet/20 bg-accent-violet/[0.08] text-accent-violet"
    case "review":
    default:
      return "border-accent-blue/20 bg-accent-blue/[0.08] text-accent-blue"
  }
}

export function OverviewField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  )
}

export function MetricCard({
  label,
  value,
  detail,
}: {
  label: string
  value: ReactNode
  detail: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-lg font-medium text-foreground">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </div>
  )
}
