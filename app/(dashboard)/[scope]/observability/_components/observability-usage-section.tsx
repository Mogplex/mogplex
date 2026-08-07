import type { ObservabilityStats } from "@/hooks/use-observability";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { successTone } from "@/lib/observability/stat-card-tone";
import { MetricCell } from "./observability-metric-components";
import {
  formatCostUsd,
  formatDuration,
  formatSandboxTime,
  formatTokens,
} from "./formatters";

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
export const RECONCILIATION_WARNING_THRESHOLD = 10;

export function UsageAndCost({
  summary,
  rangeLabel,
}: {
  summary: ObservabilityStats["summary"];
  rangeLabel: string;
}) {
  const hasCalls = summary.total_calls > 0;
  const callSuccessTone = hasCalls
    ? successTone(summary.success_rate)
    : undefined;

  return (
    <section aria-labelledby="usage-summary-heading" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usage-summary-heading" className="ui-section-title">
          Usage and cost
        </h2>
        <span className="text-muted-foreground text-xs">{rangeLabel}</span>
      </div>
      <div className="border-border bg-border grid gap-px overflow-hidden rounded-md border sm:grid-cols-2 lg:grid-cols-5">
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
  );
}

export function ReconciliationNotice({ pending }: { pending: number | null }) {
  if (pending === null || pending === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        className={`decoration-muted-foreground/50 cursor-help text-left text-xs underline decoration-dotted underline-offset-2 ${
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
  );
}
