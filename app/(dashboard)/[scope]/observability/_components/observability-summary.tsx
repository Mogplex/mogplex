"use client";

import type { ObservabilityStats } from "@/hooks/use-observability";
import type { ActivityDateRangePreset } from "@/lib/observability/activity-date-range";
import { successTone } from "@/lib/observability/stat-card-tone";
import { getAutomationHealthStatus } from "@/lib/observability/automation-health";
import { HEALTH_STATES } from "./observability-metric-components";
import {
  countLabel,
  CurrentAttention,
  OperationalSignals,
  RunSuccessSummary,
  type InspectPressure,
  type InspectRuns,
} from "./observability-attention-section";
import {
  UsageAndCost,
  ReconciliationNotice,
} from "./observability-usage-section";
import { LoadingSummary } from "./observability-summary-loading";

// Re-export types for consumers of this module
export type {
  PressureOutcome,
  RunDrilldown,
} from "./observability-attention-section";

const RANGE_LABELS: Record<ActivityDateRangePreset, string> = {
  today: "today",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
  mtd: "this month",
  prev_month: "last month",
  custom: "the selected range",
};

export function ObservabilitySummary({
  summary,
  rangePreset,
  onInspectPressure,
  onInspectRuns,
  showUsage = true,
}: {
  summary?: ObservabilityStats["summary"];
  rangePreset?: ActivityDateRangePreset;
  onInspectPressure: InspectPressure;
  onInspectRuns: InspectRuns;
  showUsage?: boolean;
}) {
  if (!summary) return <LoadingSummary />;

  const rangeLabel = rangePreset
    ? RANGE_LABELS[rangePreset]
    : "the last 24 hours";
  const stalePending = summary.job_runs_stale_pending;
  const failedInRange = summary.job_runs_failed_in_range;
  const suppressedInRange = summary.suppressed_in_range;
  const deferredInRange = summary.deferred_in_range;
  const startFailedInRange = summary.start_failed_in_range;
  const oldestPendingMs = summary.oldest_pending_age_ms;
  const runSuccessRate = summary.job_runs_success_rate_in_range;
  const runsConcludedInRange = summary.job_runs_concluded_in_range;

  const runSuccessTone =
    runSuccessRate === null ? undefined : successTone(runSuccessRate);
  const healthStatus = getAutomationHealthStatus({
    failedInRange,
    stalePending,
    runSuccessRate,
  });
  const healthState = HEALTH_STATES[healthStatus];
  const healthSummary =
    healthStatus === "needs_attention"
      ? `Some runs need review in ${rangeLabel}. Past start attempts and prevented runs are listed separately.`
      : runSuccessRate === null
        ? `No automation runs reached a verdict in ${rangeLabel}. Check Needs attention for requests waiting on you.`
        : "No failed or stuck automation runs were found in this view. Check Needs attention for approval and input requests.";

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="automation-health-heading"
        className="border-border overflow-hidden rounded-md border"
      >
        <div className="border-border bg-secondary/15 flex flex-col gap-4 border-b p-4 md:flex-row md:items-center md:justify-between">
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
            <p className="text-muted-foreground max-w-2xl text-xs">
              {healthSummary}
            </p>
            <p className="text-muted-foreground text-xs">
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
            onInspectRuns={onInspectRuns}
          />
        </div>
      </section>

      {showUsage && <><UsageAndCost summary={summary} rangeLabel={rangeLabel} />
      <ReconciliationNotice pending={summary.reconciliation_pending} /></>}
    </div>
  );
}
