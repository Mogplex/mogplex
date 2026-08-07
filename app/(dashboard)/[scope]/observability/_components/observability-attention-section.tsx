import {
  STAT_TONE_VALUE_CLASSES,
  type StatTone,
} from "@/lib/observability/stat-card-tone";
import { MetricLabel, SignalButton } from "./observability-metric-components";
import { formatDuration } from "./formatters";

export type PressureOutcome = "suppressed" | "deferred" | "start_failed";
export type RunDrilldown = "failed" | "pending" | "repairable_pending";
export type InspectPressure = (outcome: PressureOutcome) => void;
export type InspectRuns = (target: RunDrilldown) => void;

export function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`
) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function hasCurrentRunIssue(
  failedInRange: number,
  stalePending: number
) {
  return failedInRange > 0 || stalePending > 0;
}

export function shouldReviewRunSuccess(
  runSuccessTone: StatTone | undefined,
  hasCurrentIssue: boolean
) {
  return runSuccessTone === "failure" && !hasCurrentIssue;
}

export function hasAttentionItems({
  hasCurrentIssue,
  successNeedsReview,
}: {
  hasCurrentIssue: boolean;
  successNeedsReview: boolean;
}) {
  return hasCurrentIssue || successNeedsReview;
}

export function CurrentAttention({
  failedInRange,
  stalePending,
  startFailedInRange,
  deferredInRange,
  oldestPendingMs,
  runSuccessTone,
  onInspectRuns,
}: {
  failedInRange: number;
  stalePending: number;
  startFailedInRange: number;
  deferredInRange: number;
  oldestPendingMs: number;
  runSuccessTone?: StatTone;
  onInspectRuns: InspectRuns;
}) {
  const hasCurrentIssue = hasCurrentRunIssue(failedInRange, stalePending);
  const successNeedsReview = shouldReviewRunSuccess(
    runSuccessTone,
    hasCurrentIssue
  );
  const hasAttentionItem = hasAttentionItems({
    hasCurrentIssue,
    successNeedsReview,
  });

  return (
    <div className="border-border bg-secondary/10 border-t px-4 py-3">
      <div className="grid gap-2 lg:grid-cols-[9rem_minmax(0,1fr)] lg:items-start">
        <div className="text-foreground pt-1.5 text-xs font-medium">
          Action required
        </div>
        <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
          {failedInRange > 0 ? (
            <button
              type="button"
              className="hover:bg-secondary focus-visible:ring-ring block w-full rounded-sm px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
              onClick={() => onInspectRuns("failed")}
            >
              <span className="block text-xs font-medium text-[var(--accent-red)]">
                {countLabel(
                  failedInRange,
                  "run remains failed",
                  "runs remain failed"
                )}
              </span>
              <span className="text-muted-foreground mt-0.5 block text-[11px]">
                Inspect the run, owner, and latest automation outcome.
              </span>
            </button>
          ) : null}
          {stalePending > 0 ? (
            <button
              type="button"
              className="hover:bg-secondary focus-visible:ring-ring block w-full rounded-sm px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
              onClick={() => onInspectRuns("repairable_pending")}
            >
              <span className="block text-xs font-medium text-[var(--accent-amber)]">
                {countLabel(
                  stalePending,
                  "pending run needs recovery",
                  "pending runs need recovery"
                )}
              </span>
              <span className="text-muted-foreground mt-0.5 block text-[11px]">
                Oldest has waited {formatDuration(oldestPendingMs)}.
              </span>
            </button>
          ) : null}
          {successNeedsReview ? (
            <button
              type="button"
              className="hover:bg-secondary focus-visible:ring-ring block w-full rounded-sm px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
              onClick={() => onInspectRuns("failed")}
            >
              <span className="block text-xs font-medium text-[var(--accent-red)]">
                Run success needs review
              </span>
              <span className="text-muted-foreground mt-0.5 block text-[11px]">
                Inspect failed verdicts in the selected range.
              </span>
            </button>
          ) : null}
          {!hasAttentionItem ? (
            <div className="rounded-sm px-2 py-1.5">
              <span className="block text-xs font-medium text-[var(--accent-green)]">
                No action needed
              </span>
              <span className="text-muted-foreground mt-0.5 block text-[11px]">
                {deferredInRange > 0
                  ? `${countLabel(deferredInRange, "delayed start attempt")} retried automatically; no failed or stale runs need attention.`
                  : startFailedInRange > 0
                    ? "No failed or stale runs need action. Recent start failures remain available in operational history."
                    : "No failed or stale pending runs need action."}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function RunSuccessSummary({
  rate,
  tone,
  concluded,
  repaired,
}: {
  rate: number | null;
  tone?: StatTone;
  concluded: number;
  repaired: number;
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
      <div className="text-muted-foreground mt-0.5 text-xs">
        {countLabel(concluded, "concluded run")} ·{" "}
        {countLabel(repaired, "repaired run")}
      </div>
    </div>
  );
}

export function OperationalSignals({
  suppressedInRange,
  deferredInRange,
  startFailedInRange,
  pendingRuns,
  stalePending,
  oldestPendingMs,
  onInspectPressure,
  onInspectRuns,
}: {
  suppressedInRange: number;
  deferredInRange: number;
  startFailedInRange: number;
  pendingRuns: number;
  stalePending: number;
  oldestPendingMs: number;
  onInspectPressure: InspectPressure;
  onInspectRuns: InspectRuns;
}) {
  return (
    <div className="min-w-0">
      <div className="border-border text-foreground border-b px-4 py-2.5 text-xs font-medium">
        Operational signals
      </div>
      <div className="bg-border grid gap-px sm:grid-cols-2 xl:grid-cols-4">
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
  );
}
