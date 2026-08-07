import type { FlowRunDetail, FlowRunRecord, FlowWait } from "@/lib/types";

// Re-export parsing utilities from the parsing module.
export {
  isRecord,
  readNodeRunRole,
  readNodeRunSummary,
  formatRunSourceType,
} from "./run-presentation-parsing";

// Re-export status/tone presentation from the status module.
export type { FlowRunStatusLabel } from "./run-presentation-status";
export {
  runStatusTone,
  nodeRunStatusTone,
  dispatchEventKindLabel,
  dispatchOutcomeLabel,
  dispatchOutcomeTone,
  callStatusTone,
  reviewFindingSeverityLabel,
  reviewFindingSeverityTone,
  formatReviewFindingLocation,
} from "./run-presentation-status";

// Re-export link resolution from the links module.
export type { ReviewedTargetLink } from "./run-presentation-links";
export {
  resolveReviewFindingIssueLink,
  resolveCommitUrl,
  resolveReviewedTargetLink,
} from "./run-presentation-links";

// Re-export edit diff collection from the edits module.
export type { RunEditDiff } from "./run-presentation-edits";
export {
  MAX_RUN_EDIT_DIFFS,
  collectRunEditDiffs,
} from "./run-presentation-edits";

// Keep run action visibility and run-status presentation centralized here so
// the recent-runs rail and details modal stay in sync.
export type FlowRunAction = "repair" | "requeue" | "cancel";

export type RunActionDescriptor = {
  action: FlowRunAction;
  label: string;
  emphasis: "primary" | "secondary" | "destructive";
};

export type RunCancellationState = {
  label: string;
  detail: string;
  finalizedByReconciliation: boolean;
};

export function getActiveFlowWaits(run: Pick<FlowRunDetail, "waits">) {
  return (run.waits ?? []).filter((wait) => wait.status === "waiting");
}

export function flowRunStatusLabel(
  run: Pick<FlowRunDetail, "status" | "waits" | "active_wait_count">
) {
  const hasActiveWait =
    (run.active_wait_count ?? 0) > 0 || getActiveFlowWaits(run).length > 0;
  return run.status === "running" && hasActiveWait ? "waiting" : run.status;
}

export function flowWaitDescription(wait: FlowWait) {
  const config = wait.wait_config;
  switch (config.kind) {
    case "github_label_added":
      return `GitHub label "${config.labelName}"`;
    case "github_comment_added": {
      const author = config.authorLogin ? ` from @${config.authorLogin}` : "";
      const body = config.bodyContains
        ? ` containing "${config.bodyContains}"`
        : "";
      return `GitHub comment${author}${body}`;
    }
    case "ci_workflow_completed":
      return `${config.workflowName} · ${config.conclusion}`;
    case "vercel_preview_ready":
      return `Vercel ${config.environment} deployment`;
    case "manual_approval":
      return config.prompt;
    case "tool_approval":
      return `Approval for ${config.toolName}`;
  }
}

export function getRunLatestReason(
  run: Pick<
    FlowRunRecord,
    "error" | "last_start_error" | "cancel_error" | "latest_dispatch_event"
  >
) {
  return (
    run.cancel_error ||
    run.error ||
    run.last_start_error ||
    run.latest_dispatch_event?.reason ||
    null
  );
}

export function getRunCancellationState(
  run: Pick<
    FlowRunDetail,
    | "cancel_requested_at"
    | "cancelled_at"
    | "cancel_reason"
    | "cancel_error"
    | "dispatch_events"
  >
) {
  let reconciledEvent: FlowRunDetail["dispatch_events"][number] | null = null;
  for (let index = run.dispatch_events.length - 1; index >= 0; index -= 1) {
    const event = run.dispatch_events[index];
    if (event.outcome === "reconciled") {
      reconciledEvent = event;
      break;
    }
  }

  if (run.cancelled_at) {
    return {
      label: "Cancelled",
      detail: run.cancel_reason || "Cancellation completed",
      finalizedByReconciliation: Boolean(reconciledEvent),
    } satisfies RunCancellationState;
  }

  if (run.cancel_requested_at && run.cancel_error) {
    return {
      label: "Cancel failed",
      detail: run.cancel_error,
      finalizedByReconciliation: Boolean(reconciledEvent),
    } satisfies RunCancellationState;
  }

  if (run.cancel_requested_at) {
    return {
      label: "Cancel requested",
      detail: run.cancel_reason || "Waiting for runtime cancellation",
      finalizedByReconciliation: Boolean(reconciledEvent),
    } satisfies RunCancellationState;
  }

  return null;
}

export function getRunActionDescriptors(
  run: Pick<
    FlowRunRecord,
    "status" | "cancelable" | "repairable" | "requeueable"
  >
): RunActionDescriptor[] {
  if (run.status === "running") {
    return run.cancelable
      ? [
          {
            action: "cancel",
            label: "Cancel",
            emphasis: "destructive",
          },
        ]
      : [];
  }

  if (run.status === "pending") {
    const actions: RunActionDescriptor[] = [];

    if (run.repairable) {
      actions.push({
        action: "repair",
        label: "Repair",
        emphasis: "primary",
      });
    }

    if (run.cancelable) {
      actions.push({
        action: "cancel",
        label: "Cancel",
        emphasis: "destructive",
      });
    }

    return actions;
  }

  if (run.status === "failed") {
    const actions: RunActionDescriptor[] = [];

    if (run.requeueable) {
      actions.push({
        action: "requeue",
        label: "Retry",
        emphasis: "secondary",
      });
    }

    if (run.repairable) {
      actions.push({
        action: "repair",
        label: "Repair",
        emphasis: "secondary",
      });
    }

    return actions;
  }

  return [];
}

export function getRunActionEmptyState(
  run: Pick<
    FlowRunRecord,
    "status" | "cancelable" | "repairable" | "requeueable"
  >
) {
  switch (run.status) {
    case "success":
      return "Completed runs do not have follow-up actions.";
    case "cancelled":
      return "This run is already cancelled.";
    case "pending":
    case "running":
      return "This run is active, and no controls are currently available.";
    case "failed":
      return "This run cannot be retried or repaired from here.";
    default:
      return "No run controls are available for this execution.";
  }
}

export function formatDuration(durationMs: number | null | undefined) {
  // 0 ms is a legitimate near-instant duration; only reject invalid or skewed values.
  if (
    typeof durationMs !== "number" ||
    Number.isNaN(durationMs) ||
    durationMs < 0
  ) {
    return "n/a";
  }
  if (durationMs < 1_000) return `${durationMs}ms`;
  const seconds = durationMs / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatJson(value: unknown) {
  if (value == null) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
