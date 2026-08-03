"use client"

import type { ObservabilityStats } from "@/hooks/use-observability"
import type { ActivityDateRangePreset } from "@/lib/observability/activity-date-range"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
  info,
}: {
  label: string
  value: string
  sub?: string
  tone?: StatTone
  info?: string
}) {
  const borderClass = tone ? STAT_TONE_CLASSES[tone] : "border-border"
  const valueColorClass = tone ? STAT_TONE_VALUE_CLASSES[tone] : "text-foreground"
  return (
    <div className={`border rounded-md p-3 ${borderClass}`}>
      <div className="text-muted-foreground text-xs mb-1">
        {info ? (
          <Tooltip>
            <TooltipTrigger className="cursor-help text-left underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
              {label}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[300px] text-[11px]">
              {info}
            </TooltipContent>
          </Tooltip>
        ) : (
          label
        )}
      </div>
      <div className={`text-lg font-medium ${valueColorClass}`}>{value}</div>
      {sub && <div className="text-muted-foreground text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

// Tooltip copy below hardcodes tunable operational constants. If one of these
// changes, update the matching tooltip text:
// - 2-min staleness: STALE_PENDING_JOB_THRESHOLD_MS (lib/workflows/job-run-repair.ts)
// - 5-min repair cadence: /api/cron/repair-jobs schedule (vercel.json)
// - 10-min cost reconciliation: trigger/reconcile-ai-call-costs.ts cron
// - 1-hour reconciliation staleness: reconciliationStaleBefore (app/api/observability/stats/route.ts)

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
        <StatCard
          label="Total Runs"
          value={String(summary?.job_runs_total ?? 0)}
          sub={`${summary?.job_runs_running ?? 0} running`}
          info="Every automation job run recorded for this account, across all statuses and all time. The sub-line counts runs executing right now."
        />
        <StatCard
          label="Stale Pending"
          value={String(stalePending)}
          sub={`${summary?.job_runs_pending ?? 0} pending`}
          tone={stalePending > 0 ? "warn" : undefined}
          info="Pending runs whose last start attempt (or creation) is over 2 minutes old, making them eligible for retry by the repair cron (runs every 5 minutes). The sub-line is all pending runs, stale or not."
        />
        <StatCard
          label={`Failed · ${windowLabel}`}
          value={String(failedInRange)}
          sub={`${summary?.job_runs_repaired_in_range ?? 0} repaired`}
          tone={failedInRange > 0 ? "failure" : undefined}
          info="Runs now in failed status that started inside the selected window. Repaired counts runs whose most recent start was issued by the repair cron within the window."
        />
        <StatCard
          label={`Run Success · ${windowLabel}`}
          value={runSuccessRate === null ? "—" : `${runSuccessRate}%`}
          sub={summary ? `${runsConcludedInRange} concluded` : undefined}
          tone={runSuccessTone}
          info="Successful runs as a share of runs that reached a verdict (success or failed) inside the window, anchored on completion time. Pending, running, and cancelled runs are excluded; — means nothing concluded."
        />
        <StatCard
          label={`Sandbox Time · ${windowLabel}`}
          value={formatSandboxTime(summary?.sandbox_time_ms ?? 0)}
          sub={`${summary?.sandbox_active ?? 0} active · ${summary?.sandbox_total ?? 0} total`}
          info="Sandbox lifetime summed across all sandboxes, counting only the slice of each lifetime that overlaps the window. Active are sandboxes still running; total is all-time."
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={`Suppressed · ${windowLabel}`}
          value={String(suppressedInRange)}
          tone={suppressedInRange > 0 ? "failure" : undefined}
          info="Incoming events dropped before any run was created — duplicate deliveries, inactive or unmatched flows, queue caps, or the mention loop-breaker. No run exists for these, so they never appear in the Runs table; each event's reason is in the Pressure table below."
        />
        <StatCard
          label={`Deferred · ${windowLabel}`}
          value={String(deferredInRange)}
          tone={deferredInRange > 0 ? "warn" : undefined}
          info="Start attempts postponed because the GitHub installation's concurrency limit was full. The run stays pending; the repair cron (runs every 5 minutes) retries it once it has been pending over 2 minutes. Counts attempts, not distinct runs."
        />
        <StatCard
          label={`Start Failed · ${windowLabel}`}
          value={String(startFailedInRange)}
          tone={startFailedInRange > 0 ? "failure" : undefined}
          info="Start attempts that errored before the run began executing (claiming the job or launching the background runtime failed). The run stays pending and is retried — this counts attempts, not distinct runs, so one stuck run can rack up many. Per-attempt reasons are in the Pressure table below."
        />
        <StatCard
          label="Oldest Pending"
          value={formatDuration(oldestPendingMs)}
          tone={oldestPendingMs > 0 ? "warn" : undefined}
          info="Age of the longest-waiting pending run, measured from its last start attempt — or from creation if a start was never attempted."
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total Calls"
          value={String(summary?.total_calls ?? 0)}
          sub={rangeLabel ?? `${summary?.calls_today ?? 0} today`}
          info="AI calls that started inside the selected range — or across all time when no range is chosen, with the sub-line showing calls since midnight UTC."
        />
        <StatCard
          label="Tokens Used"
          value={formatTokens(summary?.total_tokens ?? 0)}
          sub={rangeLabel ?? `${formatTokens(summary?.tokens_today ?? 0)} today`}
          info="Input, cache, and output tokens summed over the same calls as Total Calls, falling back to each call's recorded total when no per-kind breakdown exists."
        />
        <StatCard
          label="Cost"
          value={formatCostUsd(summary?.total_cost ?? 0)}
          sub={rangeLabel ?? `${formatCostUsd(summary?.cost_today ?? 0)} today`}
          info="Sum of known per-call costs over the same calls as Total Calls. Calls whose gateway cost has not been reconciled yet contribute nothing (not $0), so this can rise as reconciliation catches up."
        />
        <StatCard
          label="Call Success"
          value={`${callSuccessRate}%`}
          sub={`${formatDuration(summary?.avg_duration_ms ?? 0)} avg`}
          tone={callSuccessTone}
          info="Calls that finished with success status as a share of all calls in the range. The sub-line is the mean duration of calls that recorded one."
        />
      </div>

      {reconciliationPending !== null && reconciliationPending > 0 && (
        <Tooltip>
          <TooltipTrigger
            className={`cursor-help text-left text-xs underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 ${reconciliationPendingClass}`}
          >
            {reconciliationPending} calls awaiting cost reconciliation
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[300px] text-[11px]">
            Gateway-billed calls whose final cost has not been fetched from the
            AI gateway yet — still in flight, or completed over an hour ago
            without a reconciled cost. A Trigger.dev cron reconciles costs
            every 10 minutes; a persistently high count means reconciliation
            is stuck.
          </TooltipContent>
        </Tooltip>
      )}
    </>
  )
}
