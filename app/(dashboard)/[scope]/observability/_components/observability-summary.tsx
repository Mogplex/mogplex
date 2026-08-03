"use client"

import type { ObservabilityStats } from "@/hooks/use-observability"
import type { ActivityDateRangePreset } from "@/lib/observability/activity-date-range"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
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

type PressureOutcome = "suppressed" | "deferred" | "start_failed"
type RunStatus = "failed" | "pending"
type InspectPressure = (outcome: PressureOutcome) => void
type InspectRuns = (status: RunStatus) => void

type HealthState = {
  label: string
  className: string
}

function MetricLabel({ label, info }: { label: string; info: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="cursor-help text-left text-xs text-muted-foreground underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
        {label}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[300px] text-[11px]">
        {info}
      </TooltipContent>
    </Tooltip>
  )
}

function MetricCell({
  label,
  value,
  detail,
  info,
  tone,
}: {
  label: string
  value: string
  detail: string
  info: string
  tone?: StatTone
}) {
  return (
    <div className="min-w-0 bg-background p-3">
      <MetricLabel label={label} info={info} />
      <div
        className={`mt-1 text-lg font-medium ${
          tone ? STAT_TONE_VALUE_CLASSES[tone] : "text-foreground"
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">
        {detail}
      </div>
    </div>
  )
}

function SignalButton({
  label,
  value,
  detail,
  ariaLabel,
  tone,
  onClick,
}: {
  label: string
  value: string
  detail: string
  ariaLabel: string
  tone?: StatTone
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="group min-w-0 bg-background p-3 text-left transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={onClick}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-foreground group-hover:text-foreground">
          {label}
        </span>
        <span
          className={`text-base font-medium ${
            tone ? STAT_TONE_VALUE_CLASSES[tone] : "text-foreground"
          }`}
        >
          {value}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </button>
  )
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function getHealthState({
  hasCurrentIssue,
  hasRecentPressure,
  runSuccessRate,
  runSuccessTone,
}: {
  hasCurrentIssue: boolean
  hasRecentPressure: boolean
  runSuccessRate: number | null
  runSuccessTone?: StatTone
}): HealthState {
  if (hasCurrentIssue || runSuccessTone === "failure") {
    return {
      label: "Needs attention",
      className:
        "border-[var(--accent-red)]/20 bg-[var(--accent-red)]/5 text-[var(--accent-red)]",
    }
  }
  if (hasRecentPressure || runSuccessTone === "warn") {
    return {
      label: "Recent pressure",
      className:
        "border-[var(--accent-amber)]/20 bg-[var(--accent-amber)]/5 text-[var(--accent-amber)]",
    }
  }
  if (runSuccessRate === null) {
    return {
      label: "No conclusions",
      className: "border-border bg-secondary/40 text-muted-foreground",
    }
  }
  return {
    label: "Operating normally",
    className:
      "border-[var(--accent-green)]/20 bg-[var(--accent-green)]/5 text-[var(--accent-green)]",
  }
}

function hasCurrentRunIssue(failedInRange: number, stalePending: number) {
  return failedInRange > 0 || stalePending > 0
}

function shouldReviewRunSuccess(
  runSuccessTone: StatTone | undefined,
  hasCurrentIssue: boolean
) {
  return runSuccessTone === "failure" && !hasCurrentIssue
}

function hasAttentionItems({
  hasCurrentIssue,
  startFailedInRange,
  successNeedsReview,
}: {
  hasCurrentIssue: boolean
  startFailedInRange: number
  successNeedsReview: boolean
}) {
  return hasCurrentIssue || startFailedInRange > 0 || successNeedsReview
}

function CurrentAttention({
  failedInRange,
  stalePending,
  startFailedInRange,
  deferredInRange,
  oldestPendingMs,
  runSuccessTone,
  onInspectPressure,
  onInspectRuns,
}: {
  failedInRange: number
  stalePending: number
  startFailedInRange: number
  deferredInRange: number
  oldestPendingMs: number
  runSuccessTone?: StatTone
  onInspectPressure: InspectPressure
  onInspectRuns: InspectRuns
}) {
  const hasCurrentIssue = hasCurrentRunIssue(failedInRange, stalePending)
  const successNeedsReview = shouldReviewRunSuccess(
    runSuccessTone,
    hasCurrentIssue
  )
  const hasAttentionItem = hasAttentionItems({
    hasCurrentIssue,
    startFailedInRange,
    successNeedsReview,
  })

  return (
    <div className="border-t border-border bg-secondary/10 px-4 py-3">
      <div className="grid gap-2 lg:grid-cols-[9rem_minmax(0,1fr)] lg:items-start">
        <div className="pt-1.5 text-xs font-medium text-foreground">
          Current attention
        </div>
        <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
        {failedInRange > 0 ? (
          <button
            type="button"
            className="block w-full rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onInspectRuns("failed")}
          >
            <span className="block text-xs font-medium text-[var(--accent-red)]">
              {countLabel(
                failedInRange,
                "run remains failed",
                "runs remain failed"
              )}
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              Inspect the run, owner, and latest automation outcome.
            </span>
          </button>
        ) : null}
        {stalePending > 0 ? (
          <button
            type="button"
            className="block w-full rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onInspectRuns("pending")}
          >
            <span className="block text-xs font-medium text-[var(--accent-amber)]">
              {countLabel(
                stalePending,
                "pending run needs recovery",
                "pending runs need recovery"
              )}
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              Oldest has waited {formatDuration(oldestPendingMs)}.
            </span>
          </button>
        ) : null}
        {startFailedInRange > 0 ? (
          <button
            type="button"
            className="block w-full rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onInspectPressure("start_failed")}
          >
            <span className="block text-xs font-medium text-foreground">
              Review recent start failures
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              Confirm retries recovered and no provider pattern remains.
            </span>
          </button>
        ) : null}
        {successNeedsReview ? (
          <button
            type="button"
            className="block w-full rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onInspectRuns("failed")}
          >
            <span className="block text-xs font-medium text-[var(--accent-red)]">
              Run success needs review
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              Inspect failed verdicts in the selected range.
            </span>
          </button>
        ) : null}
        {!hasAttentionItem ? (
          <div className="rounded-sm px-2 py-1.5">
            <span className="block text-xs font-medium text-[var(--accent-green)]">
              No current run issues
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {deferredInRange > 0
                ? `${countLabel(deferredInRange, "delayed attempt")} with no stale backlog.`
                : "No failed or stale pending runs need action."}
            </span>
          </div>
        ) : null}
        </div>
      </div>
    </div>
  )
}

function RunSuccessSummary({
  rate,
  tone,
  concluded,
  repaired,
}: {
  rate: number | null
  tone?: StatTone
  concluded: number
  repaired: number
}) {
  return (
    <div className="shrink-0 md:text-right">
      <MetricLabel
        label="Run success"
        info="Successful runs as a share of runs that reached a verdict inside the selected window. Pending, running, and cancelled runs are excluded."
      />
      <div
        className={`mt-0.5 text-2xl font-medium ${
          tone ? STAT_TONE_VALUE_CLASSES[tone] : "text-foreground"
        }`}
      >
        {rate === null ? "No verdicts" : `${rate}%`}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {countLabel(concluded, "concluded run")} ·{" "}
        {countLabel(repaired, "repaired run")}
      </div>
    </div>
  )
}

function OperationalSignals({
  suppressedInRange,
  deferredInRange,
  startFailedInRange,
  pendingRuns,
  stalePending,
  oldestPendingMs,
  onInspectPressure,
  onInspectRuns,
}: {
  suppressedInRange: number
  deferredInRange: number
  startFailedInRange: number
  pendingRuns: number
  stalePending: number
  oldestPendingMs: number
  onInspectPressure: InspectPressure
  onInspectRuns: InspectRuns
}) {
  return (
    <div className="min-w-0">
      <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-foreground">
        Operational signals
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
        <SignalButton
          label="Prevented"
          value={String(suppressedInRange)}
          detail={countLabel(
            suppressedInRange,
            "event not run",
            "events not run"
          )}
          ariaLabel={`Inspect ${countLabel(
            suppressedInRange,
            "prevented event",
            "prevented events"
          )}`}
          onClick={() => onInspectPressure("suppressed")}
        />
        <SignalButton
          label="Delayed"
          value={String(deferredInRange)}
          detail={countLabel(
            deferredInRange,
            "start attempt retried",
            "start attempts retried"
          )}
          ariaLabel={`Inspect ${countLabel(
            deferredInRange,
            "delayed start attempt",
            "delayed start attempts"
          )}`}
          tone={deferredInRange > 0 ? "warn" : undefined}
          onClick={() => onInspectPressure("deferred")}
        />
        <SignalButton
          label="Start failures"
          value={String(startFailedInRange)}
          detail={countLabel(
            startFailedInRange,
            "failed start attempt",
            "failed start attempts"
          )}
          ariaLabel={`Inspect ${countLabel(
            startFailedInRange,
            "failed start attempt",
            "failed start attempts"
          )}`}
          tone={startFailedInRange > 0 ? "failure" : undefined}
          onClick={() => onInspectPressure("start_failed")}
        />
        <SignalButton
          label="Oldest waiting"
          value={pendingRuns > 0 ? formatDuration(oldestPendingMs) : "None"}
          detail={`${countLabel(pendingRuns, "pending run")} · ${stalePending} stale`}
          ariaLabel={`Inspect ${countLabel(pendingRuns, "pending run")}`}
          tone={stalePending > 0 ? "warn" : undefined}
          onClick={() => onInspectRuns("pending")}
        />
      </div>
    </div>
  )
}

function UsageAndCost({
  summary,
  rangeLabel,
}: {
  summary: ObservabilityStats["summary"]
  rangeLabel: string
}) {
  const hasCalls = summary.total_calls > 0
  const callSuccessTone = hasCalls ? successTone(summary.success_rate) : undefined

  return (
    <section aria-labelledby="usage-summary-heading" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usage-summary-heading" className="ui-section-title">
          Usage and cost
        </h2>
        <span className="text-xs text-muted-foreground">{rangeLabel}</span>
      </div>
      <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
        <MetricCell
          label="AI calls"
          value={String(summary.total_calls)}
          detail={`${summary.calls_today} today`}
          info="AI calls that started inside the selected range. The detail shows calls since midnight UTC."
        />
        <MetricCell
          label="Tokens used"
          value={formatTokens(summary.total_tokens)}
          detail={`${formatTokens(summary.tokens_today)} today`}
          info="Input, cache, and output tokens summed across calls in the selected range."
        />
        <MetricCell
          label="Known cost"
          value={formatCostUsd(summary.total_cost)}
          detail={`${formatCostUsd(summary.cost_today)} today`}
          info="Known per-call costs in the selected range. Calls still awaiting gateway reconciliation contribute nothing until their final cost arrives."
        />
        <MetricCell
          label="Call success"
          value={hasCalls ? `${summary.success_rate}%` : "No calls"}
          detail={
            hasCalls
              ? `${formatDuration(summary.avg_duration_ms)} average`
              : "No activity in range"
          }
          tone={callSuccessTone}
          info="Calls that finished successfully as a share of all calls in the selected range."
        />
        <MetricCell
          label="Sandbox time"
          value={formatSandboxTime(summary.sandbox_time_ms)}
          detail={`${summary.sandbox_active} active · ${summary.sandbox_total} total`}
          info="Sandbox lifetime overlapping the selected range. Active and total counts are current and all-time respectively."
        />
      </div>
    </section>
  )
}

function ReconciliationNotice({ pending }: { pending: number | null }) {
  if (pending === null || pending === 0) return null

  return (
    <Tooltip>
      <TooltipTrigger
        className={`cursor-help text-left text-xs underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 ${
          pending > RECONCILIATION_WARNING_THRESHOLD
            ? "text-accent-amber"
            : "text-muted-foreground"
        }`}
      >
        {pending} calls awaiting cost reconciliation
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[300px] text-[11px]">
        Gateway-billed calls whose final cost has not been fetched from the AI
        gateway yet. A Trigger.dev cron reconciles costs every 10 minutes; a
        persistently high count means reconciliation is stuck.
      </TooltipContent>
    </Tooltip>
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
  "7d": "the last 7 days",
  "30d": "the last 30 days",
  mtd: "this month",
  prev_month: "last month",
  custom: "the selected range",
}

function LoadingSummary() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading observability summary">
      <section className="overflow-hidden rounded-md border border-border">
        <div className="flex items-center justify-between gap-4 border-b border-border p-4">
          <div className="space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-secondary" />
            <div className="h-3 w-56 animate-pulse rounded bg-secondary" />
          </div>
          <div className="h-8 w-24 animate-pulse rounded bg-secondary" />
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-20 animate-pulse bg-secondary/40" />
          ))}
        </div>
      </section>
      <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-20 animate-pulse bg-secondary/40" />
        ))}
      </div>
    </div>
  )
}

export function ObservabilitySummary({
  summary,
  rangePreset,
  onInspectPressure,
  onInspectRuns,
}: {
  summary?: ObservabilityStats["summary"]
  rangePreset?: ActivityDateRangePreset
  onInspectPressure: InspectPressure
  onInspectRuns: InspectRuns
}) {
  if (!summary) return <LoadingSummary />

  const rangeLabel = rangePreset ? RANGE_LABELS[rangePreset] : "the last 24 hours"
  const stalePending = summary.job_runs_stale_pending
  const failedInRange = summary.job_runs_failed_in_range
  const suppressedInRange = summary.suppressed_in_range
  const deferredInRange = summary.deferred_in_range
  const startFailedInRange = summary.start_failed_in_range
  const oldestPendingMs = summary.oldest_pending_age_ms
  const runSuccessRate = summary.job_runs_success_rate_in_range
  const runsConcludedInRange = summary.job_runs_concluded_in_range

  const runSuccessTone =
    runSuccessRate === null ? undefined : successTone(runSuccessRate)
  const hasCurrentIssue = hasCurrentRunIssue(failedInRange, stalePending)
  const hasRecentPressure = deferredInRange > 0 || startFailedInRange > 0
  const healthState = getHealthState({
    hasCurrentIssue,
    hasRecentPressure,
    runSuccessRate,
    runSuccessTone,
  })

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="automation-health-heading"
        className="overflow-hidden rounded-md border border-border"
      >
        <div className="flex flex-col gap-4 border-b border-border bg-secondary/15 p-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="automation-health-heading" className="ui-section-title">
                Automation health
              </h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${healthState.className}`}
              >
                {healthState.label}
              </span>
            </div>
            <p className="max-w-2xl text-xs text-muted-foreground">
              Delivery reliability and controls across {rangeLabel}. Current
              issues are separated from prevented events and recovered pressure.
            </p>
            <p className="text-xs text-muted-foreground">
              {countLabel(summary.job_runs_running, "running run")} ·{" "}
              {countLabel(summary.job_runs_pending, "pending run")} ·{" "}
              {summary.job_runs_total} tracked all time
            </p>
          </div>

          <RunSuccessSummary
            rate={runSuccessRate}
            tone={runSuccessTone}
            concluded={runsConcludedInRange}
            repaired={summary.job_runs_repaired_in_range}
          />
        </div>

        <div>
          <OperationalSignals
            suppressedInRange={suppressedInRange}
            deferredInRange={deferredInRange}
            startFailedInRange={startFailedInRange}
            pendingRuns={summary.job_runs_pending}
            stalePending={stalePending}
            oldestPendingMs={oldestPendingMs}
            onInspectPressure={onInspectPressure}
            onInspectRuns={onInspectRuns}
          />

          <CurrentAttention
            failedInRange={failedInRange}
            stalePending={stalePending}
            startFailedInRange={startFailedInRange}
            deferredInRange={deferredInRange}
            oldestPendingMs={oldestPendingMs}
            runSuccessTone={runSuccessTone}
            onInspectPressure={onInspectPressure}
            onInspectRuns={onInspectRuns}
          />
        </div>
      </section>

      <UsageAndCost summary={summary} rangeLabel={rangeLabel} />
      <ReconciliationNotice pending={summary.reconciliation_pending} />
    </div>
  )
}
