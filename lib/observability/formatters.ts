import {
  formatAutomationOutcomeLabel,
  formatAutomationReasonLabel,
  getReviewOutcomeSummary,
} from "@/lib/automation-review";
import type { AutomationDispatchEvent, ObservabilityJob } from "@/lib/types";

export const CALL_TYPE_LABELS: Record<string, string> = {
  chat: "Chat",
  pr_review: "PR Review",
  cron_refactor: "Cron",
  cron: "Cron",
  agent: "Agent",
  push_review: "Push Review",
  issue_triage: "Issue Triage",
  ci_failure: "CI Failure",
  mention: "Mention",
  pr_comment: "PR Comment",
  issue_comment: "Issue Comment",
  labeled: "Label Added",
  tag_push: "Tag Push",
};

export function repoShortName(fullName: string): string {
  return fullName.split("/").pop() ?? fullName;
}

export function formatTokens(n: number | null): string {
  if (n == null || n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function hasPositiveTokenCount(
  value: number | null | undefined
): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// Zero counts as "usage present" — the provider returned the field, just with a
// zero value. Use this for "did we observe usage?" checks. Use
// hasPositiveTokenCount when deciding whether to render a chip.
export function hasAnyTokenValue(
  value: number | null | undefined
): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  return `${mins}m`;
}

export function formatSandboxTime(ms: number): string {
  if (ms === 0) return "0m";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (hours < 24) return `${hours}h ${remainingMins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatCostUsd(cost: number | null | undefined): string {
  if (cost == null) return "—";
  if (cost === 0) return "$0.00";
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDispatchReason(
  reason: string | null | undefined,
  metadata?: Record<string, unknown> | null
) {
  return formatAutomationReasonLabel(reason, metadata);
}

export function formatDispatchOutcome(
  outcome: AutomationDispatchEvent["outcome"]
) {
  return formatAutomationOutcomeLabel(outcome);
}

export function getJobAutomationSummary(job: ObservabilityJob) {
  const latestDispatch = job.latest_dispatch_event;
  if (!latestDispatch) return null;

  const automationOutputSummary =
    typeof latestDispatch.metadata?.automation_output_summary === "string"
      ? latestDispatch.metadata.automation_output_summary.trim()
      : "";
  const reviewSummary = getReviewOutcomeSummary({
    outcome: latestDispatch.outcome,
    reason: latestDispatch.reason,
    metadata: latestDispatch.metadata,
    source_type: job.source_type,
  });

  return (
    reviewSummary ||
    (latestDispatch.outcome === "completed" && automationOutputSummary
      ? automationOutputSummary
      : formatDispatchReason(latestDispatch.reason, latestDispatch.metadata))
  );
}
