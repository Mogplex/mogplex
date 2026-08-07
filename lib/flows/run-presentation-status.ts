import type { FlowRunDetail, FlowRunRecord } from "@/lib/types";

export type FlowRunStatusLabel = FlowRunRecord["status"] | "waiting";

export function runStatusTone(status: FlowRunStatusLabel) {
  switch (status) {
    case "success":
      return "text-accent-green border-accent-green/20 bg-accent-green/[0.06]";
    case "running":
      return "text-accent-blue border-accent-blue/20 bg-accent-blue/[0.06]";
    case "failed":
      return "text-accent-red border-accent-red/20 bg-accent-red/[0.06]";
    case "cancelled":
      return "text-muted-foreground border-border bg-secondary/50";
    case "waiting":
    case "pending":
    default:
      return "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]";
  }
}

export function nodeRunStatusTone(
  status: FlowRunRecord["node_runs"][number]["status"]
) {
  switch (status) {
    case "success":
      return "text-accent-green border-accent-green/20 bg-accent-green/[0.06]";
    case "running":
      return "text-accent-blue border-accent-blue/20 bg-accent-blue/[0.06]";
    case "failed":
      return "text-accent-red border-accent-red/20 bg-accent-red/[0.06]";
    case "cancelled":
    case "skipped":
      return "text-muted-foreground border-border bg-secondary/50";
    case "pending":
    default:
      return "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]";
  }
}

export function dispatchEventKindLabel(
  kind: FlowRunDetail["dispatch_events"][number]["event_kind"]
) {
  switch (kind) {
    case "control":
      return "control";
    case "enqueue":
      return "enqueue";
    case "start":
    default:
      return "start";
  }
}

export function dispatchOutcomeLabel(
  outcome: FlowRunDetail["dispatch_events"][number]["outcome"]
) {
  switch (outcome) {
    case "started":
      return "Started";
    case "queued":
      return "Queued";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancel_requested":
      return "Cancel requested";
    case "cancelled":
      return "Cancelled";
    case "cancel_failed":
      return "Cancel failed";
    case "reconciled":
      return "Reconciled";
    default:
      return outcome.replaceAll("_", " ");
  }
}

export function dispatchOutcomeTone(
  outcome: FlowRunDetail["dispatch_events"][number]["outcome"]
) {
  switch (outcome) {
    case "started":
    case "queued":
    case "completed":
      return "text-accent-green border-accent-green/20 bg-accent-green/[0.06]";
    case "suppressed":
    case "start_failed":
    case "failed":
    case "cancel_failed":
      return "text-accent-red border-accent-red/20 bg-accent-red/[0.06]";
    case "cancel_requested":
      return "text-accent-blue border-accent-blue/20 bg-accent-blue/[0.06]";
    case "cancelled":
    case "reconciled":
      return "text-muted-foreground border-border bg-secondary/50";
    case "deferred":
    default:
      return "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]";
  }
}

export function callStatusTone(status: string | null | undefined) {
  switch (status) {
    case "success":
      return "text-accent-green border-accent-green/20 bg-accent-green/[0.06]";
    case "failed":
      return "text-accent-red border-accent-red/20 bg-accent-red/[0.06]";
    case "streaming":
      return "text-accent-blue border-accent-blue/20 bg-accent-blue/[0.06]";
    case "pending":
    default:
      return "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]";
  }
}

export function reviewFindingSeverityLabel(
  severity: FlowRunDetail["review_findings"][number]["severity"]
) {
  switch (severity) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    case "suggestion":
    default:
      return "Suggestion";
  }
}

export function reviewFindingSeverityTone(
  severity: FlowRunDetail["review_findings"][number]["severity"]
) {
  switch (severity) {
    case "critical":
      return "text-accent-red border-accent-red/20 bg-accent-red/[0.06]";
    case "warning":
      return "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]";
    case "suggestion":
    default:
      return "text-accent-blue border-accent-blue/20 bg-accent-blue/[0.06]";
  }
}

export function formatReviewFindingLocation(
  finding: Pick<FlowRunDetail["review_findings"][number], "path" | "line">
) {
  if (!finding.path) return null;
  return finding.line == null
    ? finding.path
    : `${finding.path}:L${finding.line}`;
}
