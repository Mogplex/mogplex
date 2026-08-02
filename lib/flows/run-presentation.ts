import type {
  FlowAgentNodeRole,
  FlowRunDetail,
  FlowRunRecord,
  FlowWait,
} from "@/lib/types";

// Keep run action visibility and run-status presentation centralized here so
// the recent-runs rail and details modal stay in sync.
export type FlowRunAction = "repair" | "requeue" | "cancel";

export type RunActionDescriptor = {
  action: FlowRunAction;
  label: string;
  emphasis: "primary" | "secondary" | "destructive";
};

export type ReviewedTargetLink = {
  href: string;
  label: string;
};

export type RunCancellationState = {
  label: string;
  detail: string;
  finalizedByReconciliation: boolean;
};

export type RunEditDiff = {
  id: string;
  sourceLabel: string;
  path: string | null;
  branch: string | null;
  commitSha: string | null;
  commitUrl: string | null;
  patch: string | null;
};

// Keep run details bounded even when a workflow edits many files.
export const MAX_RUN_EDIT_DIFFS = 20;

function toOptionalTrimmedString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toOptionalPositiveInteger(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readNodeRunRole(output: unknown): FlowAgentNodeRole | null {
  if (!isRecord(output)) return null;
  const role = output.role;
  return role === "review" || role === "edit" || role === "triage"
    ? role
    : null;
}

export function readNodeRunSummary(output: unknown) {
  if (!isRecord(output) || typeof output.text !== "string") return null;
  return output.text;
}

export function formatRunSourceType(sourceType: string) {
  const normalized = sourceType.trim().toLowerCase();
  if (normalized === "pr_opened") return "PR OPENED";
  return sourceType.trim().replaceAll("_", " ");
}

export function resolveReviewFindingIssueLink(
  issueUrl: string | null | undefined
) {
  const trimmed = toOptionalTrimmedString(issueUrl);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");

    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      return null;
    }

    if (!/^\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(normalizedPath)) {
      return null;
    }

    // Reconstruct canonical form to strip query strings, fragments, and any
    // encoding the regex did not see. Do not simplify to `return trimmed`.
    return `https://github.com${normalizedPath}`;
  } catch {
    return null;
  }
}

// Defense-in-depth: tool-call outputs are persisted opaquely, so a buggy or
// malicious upstream could land anything in `commitUrl` (including
// `javascript:` URLs). Mirror `resolveReviewFindingIssueLink` and only allow
// canonical GitHub commit URLs through to the rendered <a href>.
export function resolveCommitUrl(commitUrl: string | null | undefined) {
  const trimmed = toOptionalTrimmedString(commitUrl);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");

    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      return null;
    }

    if (!/^\/[\w.-]+\/[\w.-]+\/commit\/[a-f0-9]{7,64}$/i.test(normalizedPath)) {
      return null;
    }

    // Reconstruct canonical form to strip query strings, fragments, and any
    // encoding the regex did not see.
    return `https://github.com${normalizedPath}`;
  } catch {
    return null;
  }
}

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

const COMMIT_SHA_PATTERN = /^[a-f0-9]{7,64}$/i;

function toOptionalCommitSha(value: unknown) {
  const trimmed = toOptionalTrimmedString(value);
  if (!trimmed) return null;
  return COMMIT_SHA_PATTERN.test(trimmed) ? trimmed : null;
}

function resolveCanonicalPullRequestLink(value: unknown) {
  const trimmed = toOptionalTrimmedString(value);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    const match = normalizedPath.match(
      /^\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/pull\/(\d+)$/
    );
    const prNumber = toOptionalPositiveInteger(match?.[3]);

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "github.com" ||
      !match ||
      prNumber == null
    ) {
      return null;
    }

    return {
      href: `https://github.com/${match[1]}/${match[2]}/pull/${prNumber}`,
      label: `PR #${prNumber}`,
    } satisfies ReviewedTargetLink;
  } catch {
    return null;
  }
}

export function resolveReviewedTargetLink(
  run: Pick<FlowRunRecord, "repo" | "metadata"> | null
): ReviewedTargetLink | null {
  if (!run) return null;
  const metadata = isRecord(run.metadata) ? run.metadata : null;
  const canonicalPrLink = resolveCanonicalPullRequestLink(metadata?.pr_url);
  if (canonicalPrLink) return canonicalPrLink;

  const repoFullName = toOptionalTrimmedString(run.repo?.full_name);
  if (
    !repoFullName ||
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repoFullName)
  ) {
    return null;
  }

  const prNumber = toOptionalPositiveInteger(metadata?.pr_number);
  if (prNumber != null) {
    return {
      href: `https://github.com/${repoFullName}/pull/${prNumber}`,
      label: `PR #${prNumber}`,
    } satisfies ReviewedTargetLink;
  }

  const issueNumber = toOptionalPositiveInteger(metadata?.issue_number);
  if (issueNumber != null) {
    // GitHub PR comments come in via the issue_comment webhook with
    // `is_pr: true` and the PR number stored in `issue_number`. Route those to
    // the pull request URL so the link points at the conversation the user
    // actually saw.
    if (metadata?.is_pr === true) {
      return {
        href: `https://github.com/${repoFullName}/pull/${issueNumber}`,
        label: `PR #${issueNumber}`,
      } satisfies ReviewedTargetLink;
    }
    return {
      href: `https://github.com/${repoFullName}/issues/${issueNumber}`,
      label: `Issue #${issueNumber}`,
    } satisfies ReviewedTargetLink;
  }

  const commitSha =
    toOptionalCommitSha(metadata?.head_sha) ??
    toOptionalCommitSha(metadata?.commit_id);
  if (commitSha) {
    return {
      href: `https://github.com/${repoFullName}/commit/${commitSha}`,
      label: `Commit ${commitSha.slice(0, 7)}`,
    } satisfies ReviewedTargetLink;
  }

  return null;
}

function readRecordField(value: unknown, field: string) {
  return isRecord(value) ? value[field] : null;
}

function readToolCallEditDiff(input: {
  toolCall: unknown;
  sourceLabel: string;
  fallbackId: string;
}): RunEditDiff | null {
  const toolCall = isRecord(input.toolCall) ? input.toolCall : null;
  if (!toolCall) return null;

  const toolName =
    toOptionalTrimmedString(toolCall.name) ??
    toOptionalTrimmedString(toolCall.toolName);
  if (toolName !== "updateFile") return null;

  const toolInput = readRecordField(toolCall, "input");
  const toolOutput = readRecordField(toolCall, "output");
  if (!isRecord(toolOutput)) return null;

  const path =
    toOptionalTrimmedString(readRecordField(toolOutput, "path")) ??
    toOptionalTrimmedString(readRecordField(toolInput, "path"));
  const branch = toOptionalTrimmedString(readRecordField(toolOutput, "branch"));
  const commitSha = toOptionalTrimmedString(
    readRecordField(toolOutput, "commitSha")
  );
  // Sanitize at collection time so the field that lands in the rendered
  // <a href> is always a canonical https://github.com/<owner>/<repo>/commit/<sha>
  // URL — never a `javascript:` URL or arbitrary attacker-controlled string.
  const commitUrl = resolveCommitUrl(
    toOptionalTrimmedString(readRecordField(toolOutput, "commitUrl"))
  );
  const success = toolOutput.success;
  if (success === false) return null;
  if (success !== true && !commitSha && !commitUrl) return null;

  const patch =
    toOptionalTrimmedString(readRecordField(toolOutput, "patch")) ??
    toOptionalTrimmedString(readRecordField(toolOutput, "diff"));

  if (!path && !commitSha && !commitUrl && !patch) return null;

  return {
    // fallbackId includes the tool-call index; it only runs for degraded
    // records where the commit metadata is missing.
    id:
      commitSha ??
      commitUrl ??
      `${input.fallbackId}:updateFile:${path ?? "edit"}`,
    sourceLabel: input.sourceLabel,
    path,
    branch,
    commitSha,
    commitUrl,
    patch,
  } satisfies RunEditDiff;
}

function readNodeRunToolCalls(output: unknown) {
  const toolCalls = readRecordField(output, "tool_calls");
  return Array.isArray(toolCalls) ? toolCalls : [];
}

export function collectRunEditDiffs(run: FlowRunDetail) {
  const edits: RunEditDiff[] = [];
  const seen = new Set<string>();

  const append = (edit: RunEditDiff | null) => {
    if (!edit || seen.has(edit.id)) return;
    seen.add(edit.id);
    edits.push(edit);
  };

  for (const nodeRun of run.node_runs) {
    const sourceLabel = nodeRun.node_label || nodeRun.node_id;
    for (const [index, toolCall] of readNodeRunToolCalls(
      nodeRun.output
    ).entries()) {
      append(
        readToolCallEditDiff({
          toolCall,
          sourceLabel,
          fallbackId: `${nodeRun.id}:${index}`,
        })
      );
    }
  }

  for (const call of run.ai_calls) {
    for (const [index, toolCall] of call.tool_calls.entries()) {
      append(
        readToolCallEditDiff({
          toolCall,
          sourceLabel: call.model,
          fallbackId: `${call.id}:${index}`,
        })
      );
    }
  }

  return edits.slice(0, MAX_RUN_EDIT_DIFFS);
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
