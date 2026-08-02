"use client"

import type { ObservabilityStats } from "@/hooks/use-observability"
import type { ActivityDateRangePreset } from "@/lib/observability/activity-date-range"
import {
  STAT_TONE_CLASSES,
  STAT_TONE_VALUE_CLASSES,
  type StatTone,
  successTone,
} from "@/lib/observability/stat-card-tone"
import {
  formatCostUsd,
  formatDuration,
  formatSandboxTime,
  formatTokens,
} from "./formatters"

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: StatTone
}) {
  const borderClass = tone ? STAT_TONE_CLASSES[tone] : "border-border"
  const valueColorClass = tone ? STAT_TONE_VALUE_CLASSES[tone] : "text-foreground"
  return (
    <div className={`border rounded-md p-3 ${borderClass}`}>
      <div className="text-muted-foreground text-xs mb-1">{label}</div>
      <div className={`text-lg font-medium ${valueColorClass}`}>{value}</div>
      {sub && <div className="text-muted-foreground text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

// Threshold is a count of pending calls (not duration). Above this, the
// reconciliation hint turns amber. Tuned against typical Anthropic
// reconciliation latency (~minutes); revisit if reconciler throughput or
// the provider SLA changes materially.
const RECONCILIATION_WARNING_THRESHOLD = 10

const RANGE_LABELS: Record<ActivityDateRangePreset, string> = {
  today: "today",
  "7d": "in last 7 days",
  "30d": "in last 30 days",
  mtd: "this month",
  prev_month: "last month",
  custom: "in selected range",
}

// Short window suffix for card titles ("Failed · 7d"). Falls back to "24h"
// when no range is selected, matching the API's default window.
const RANGE_WINDOW_LABELS: Record<ActivityDateRangePreset, string> = {
  today: "Today",
  "7d": "7d",
  "30d": "30d",
  mtd: "MTD",
  prev_month: "Prev Month",
  custom: "Range",
}

export function ObservabilitySummary({
  summary,
  rangePreset,
}: {
  summary?: ObservabilityStats["summary"]
  rangePreset?: ActivityDateRangePreset
}) {
  const rangeLabel = rangePreset ? RANGE_LABELS[rangePreset] : undefined
  const windowLabel = rangePreset ? RANGE_WINDOW_LABELS[rangePreset] : "24h"

  const stalePending = summary?.job_runs_stale_pending ?? 0
  const failedInRange = summary?.job_runs_failed_in_range ?? 0
  const suppressedInRange = summary?.suppressed_in_range ?? 0
  const deferredInRange = summary?.deferred_in_range ?? 0
  const startFailedInRange = summary?.start_failed_in_range ?? 0
  const oldestPendingMs = summary?.oldest_pending_age_ms ?? 0
  // null = no runs concluded in the window (show "—"), distinct from a real 0%.
  const runSuccessRate = summary?.job_runs_success_rate_in_range ?? null
  const runsConcludedInRange = summary?.job_runs_concluded_in_range ?? 0
  const callSuccessRate = summary?.success_rate ?? 0
  // null = count unavailable (e.g. upstream query failed); distinct from 0.
  const reconciliationPending = summary?.reconciliation_pending ?? null

  const runSuccessTone =
    summary && runSuccessRate !== null ? successTone(runSuccessRate) : undefined
  const callSuccessTone = summary ? successTone(callSuccessRate) : undefined
  const reconciliationPendingClass =
    reconciliationPending !== null &&
    reconciliationPending > RECONCILIATION_WARNING_THRESHOLD
      ? "text-accent-amber"
      : "text-muted-foreground"

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Runs" value={String(summary?.job_runs_total ?? 0)} sub={`${summary?.job_runs_running ?? 0} running`} />
        <StatCard
          label="Stale Pending"
          value={String(stalePending)}
          sub={`${summary?.job_runs_pending ?? 0} pending`}
          tone={stalePending > 0 ? "warn" : undefined}
        />
        <StatCard
          label={`Failed · ${windowLabel}`}
          value={String(failedInRange)}
          sub={`${summary?.job_runs_repaired_in_range ?? 0} repaired`}
          tone={failedInRange > 0 ? "failure" : undefined}
        />
        <StatCard
          label={`Run Success · ${windowLabel}`}
          value={runSuccessRate === null ? "—" : `${runSuccessRate}%`}
          sub={summary ? `${runsConcludedInRange} concluded` : undefined}
          tone={runSuccessTone}
        />
        <StatCard label={`Sandbox Time · ${windowLabel}`} value={formatSandboxTime(summary?.sandbox_time_ms ?? 0)} sub={`${summary?.sandbox_active ?? 0} active · ${summary?.sandbox_total ?? 0} total`} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={`Suppressed · ${windowLabel}`}
          value={String(suppressedInRange)}
          tone={suppressedInRange > 0 ? "failure" : undefined}
        />
        <StatCard
          label={`Deferred · ${windowLabel}`}
          value={String(deferredInRange)}
          tone={deferredInRange > 0 ? "warn" : undefined}
        />
        <StatCard
          label={`Start Failed · ${windowLabel}`}
          value={String(startFailedInRange)}
          tone={startFailedInRange > 0 ? "failure" : undefined}
        />
        <StatCard
          label="Oldest Pending"
          value={formatDuration(oldestPendingMs)}
          tone={oldestPendingMs > 0 ? "warn" : undefined}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total Calls"
          value={String(summary?.total_calls ?? 0)}
          sub={rangeLabel ?? `${summary?.calls_today ?? 0} today`}
        />
        <StatCard
          label="Tokens Used"
          value={formatTokens(summary?.total_tokens ?? 0)}
          sub={rangeLabel ?? `${formatTokens(summary?.tokens_today ?? 0)} today`}
        />
        <StatCard
          label="Cost"
          value={formatCostUsd(summary?.total_cost ?? 0)}
          sub={rangeLabel ?? `${formatCostUsd(summary?.cost_today ?? 0)} today`}
        />
        <StatCard
          label="Call Success"
          value={`${callSuccessRate}%`}
          sub={`${formatDuration(summary?.avg_duration_ms ?? 0)} avg`}
          tone={callSuccessTone}
        />
      </div>

      {reconciliationPending !== null && reconciliationPending > 0 && (
        <div className={`text-xs ${reconciliationPendingClass}`}>
          {reconciliationPending} calls awaiting cost reconciliation
        </div>
      )}
    </>
  )
}
