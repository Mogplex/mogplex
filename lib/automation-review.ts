import type {
  AutomationDispatchEvent,
  FlowRunDispatchTimelineEvent,
} from "@/lib/types";

export const PR_REVIEW_REASON_CODES = {
  duplicateHeadSha: "DUPLICATE_PR_HEAD_SHA",
  staleHeadSha: "PR_REVIEW_STALE_HEAD_SHA",
  posted: "PR_REVIEW_POSTED",
  noFindings: "PR_REVIEW_NO_FINDINGS",
  infraFailed: "PR_REVIEW_INFRA_FAILED",
  checkRunFailed: "PR_REVIEW_CHECK_RUN_FAILED",
  timelineCommentFailed: "PR_REVIEW_TIMELINE_COMMENT_FAILED",
  commentPostFailed: "PR_REVIEW_COMMENT_POST_FAILED",
  githubAuthFailed: "PR_REVIEW_GITHUB_AUTH_FAILED",
  skippedDraft: "SKIPPED_DRAFT_PR",
  skippedBotSynchronize: "SKIPPED_BOT_SYNCHRONIZE",
} as const;

export const AUTOMATION_REASON_CODES = {
  completed: "AUTOMATION_COMPLETED",
  failed: "AUTOMATION_FAILED",
  timeout: "AUTOMATION_TIMEOUT",
  rateLimited: "AUTOMATION_RATE_LIMITED",
  providerUnavailable: "AUTOMATION_PROVIDER_UNAVAILABLE",
  dependencyUnavailable: "AUTOMATION_DEPENDENCY_UNAVAILABLE",
  authenticationFailed: "AUTOMATION_AUTHENTICATION_FAILED",
  configurationFailed: "AUTOMATION_CONFIGURATION_FAILED",
} as const;

type DispatchMetadata = Record<string, unknown> | null | undefined;
type DispatchEventLike =
  | Pick<
      AutomationDispatchEvent,
      "outcome" | "reason" | "metadata" | "source_type"
    >
  | (Pick<FlowRunDispatchTimelineEvent, "outcome" | "reason" | "metadata"> & {
      source_type?: string | null;
    });

export function isPrReviewSourceType(sourceType: string | null | undefined) {
  return sourceType === "pr_review" || sourceType === "pr_opened";
}

export function buildPrReviewHeadShaDedupKey(input: {
  sourceKind: "assignment" | "trigger" | "flow";
  sourceType: string;
  sourceId: string;
  repoId: string | null;
  installationId: number | null;
  metadata: Record<string, unknown>;
}) {
  if (!isPrReviewSourceType(input.sourceType)) return null;

  const prNumber = Number(input.metadata.pr_number);
  const headSha =
    typeof input.metadata.head_sha === "string"
      ? input.metadata.head_sha.trim()
      : "";

  if (!Number.isFinite(prNumber) || prNumber <= 0 || headSha.length === 0) {
    return null;
  }

  return [
    "github-pr-review",
    input.sourceKind,
    input.sourceId,
    input.sourceType,
    input.repoId ?? "no-repo",
    String(input.installationId ?? "no-installation"),
    String(prNumber),
    headSha,
  ].join(":");
}

export function normalizeAutomationReason(
  reason: string | null | undefined,
  metadata?: DispatchMetadata
) {
  if (!reason) return null;

  if (
    reason === "IDEMPOTENT_DUPLICATE" &&
    typeof metadata?.review_dedup_key === "string"
  ) {
    return PR_REVIEW_REASON_CODES.duplicateHeadSha;
  }

  return reason;
}

const REASON_LABELS: Record<string, string> = {
  [AUTOMATION_REASON_CODES.completed]: "Automation completed",
  [AUTOMATION_REASON_CODES.failed]: "Automation failed",
  [AUTOMATION_REASON_CODES.timeout]: "Timeout",
  [AUTOMATION_REASON_CODES.rateLimited]: "Rate limited",
  [AUTOMATION_REASON_CODES.providerUnavailable]: "Provider unavailable",
  [AUTOMATION_REASON_CODES.authenticationFailed]: "Authentication failed",
  [AUTOMATION_REASON_CODES.configurationFailed]: "Configuration failed",
  ACTIVE_DUPLICATE: "Active duplicate",
  IDEMPOTENT_DUPLICATE: "Duplicate request",
  REPO_CONCURRENCY_LIMIT: "Repo concurrency limit",
  INSTALLATION_CONCURRENCY_LIMIT: "Installation concurrency limit",
  REPO_PENDING_LIMIT: "Repo pending limit",
  INSTALLATION_PENDING_LIMIT: "Installation pending limit",
  ENQUEUE_FAILED: "Enqueue failed",
  START_ALREADY_STARTED: "Already started",
  START_RUNTIME_FAILED: "Runtime start failed",
  RUNTIME_HANDLE_PERSIST_FAILED: "Runtime handle persist failed",
  NO_GITHUB_CONNECTION: "GitHub auth failed",
  [PR_REVIEW_REASON_CODES.duplicateHeadSha]: "Duplicate PR head SHA",
  [PR_REVIEW_REASON_CODES.staleHeadSha]: "Stale PR head SHA",
  [PR_REVIEW_REASON_CODES.posted]: "Review posted",
  [PR_REVIEW_REASON_CODES.noFindings]: "No findings",
  [PR_REVIEW_REASON_CODES.infraFailed]: "Automation infra failed",
  [PR_REVIEW_REASON_CODES.checkRunFailed]: "Check run failed",
  [PR_REVIEW_REASON_CODES.timelineCommentFailed]: "Timeline comment failed",
  [PR_REVIEW_REASON_CODES.commentPostFailed]: "Comment post failed",
  [PR_REVIEW_REASON_CODES.githubAuthFailed]: "GitHub auth failed",
  [PR_REVIEW_REASON_CODES.skippedDraft]: "Skipped draft PR",
  [PR_REVIEW_REASON_CODES.skippedBotSynchronize]: "Skipped bot synchronize",
};

export function formatAutomationReasonLabel(
  reason: string | null | undefined,
  metadata?: DispatchMetadata
) {
  const normalized = normalizeAutomationReason(reason, metadata);
  if (!normalized) return "—";
  return (
    REASON_LABELS[normalized] ??
    normalized
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

export function classifyAutomationFailureReason(input: {
  message: string;
  execution?: { finalFailureClass: string | null } | null;
}) {
  if (input.message === "NO_GITHUB_CONNECTION") {
    return "NO_GITHUB_CONNECTION";
  }

  switch (input.execution?.finalFailureClass) {
    case "timeout":
      return AUTOMATION_REASON_CODES.timeout;
    case "rate_limited":
      return AUTOMATION_REASON_CODES.rateLimited;
    case "provider_unavailable":
      return AUTOMATION_REASON_CODES.providerUnavailable;
    case "dependency_unavailable":
      return AUTOMATION_REASON_CODES.dependencyUnavailable;
    case "authentication":
      return AUTOMATION_REASON_CODES.authenticationFailed;
    case "configuration":
      return AUTOMATION_REASON_CODES.configurationFailed;
    default:
      return AUTOMATION_REASON_CODES.failed;
  }
}

export function formatAutomationOutcomeLabel(
  outcome: AutomationDispatchEvent["outcome"]
) {
  switch (outcome) {
    case "cancel_requested":
      return "Cancel requested";
    case "cancel_failed":
      return "Cancel failed";
    case "start_failed":
      return "Start failed";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return outcome
        .replaceAll("_", " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

export function getReviewOutcomeSummary(
  event: DispatchEventLike | null | undefined
) {
  if (!event || !isPrReviewSourceType(event.source_type ?? null)) return null;

  const normalizedReason = normalizeAutomationReason(
    event.reason,
    event.metadata
  );
  if (!normalizedReason) return null;

  switch (normalizedReason) {
    case PR_REVIEW_REASON_CODES.posted:
    case PR_REVIEW_REASON_CODES.noFindings:
    case PR_REVIEW_REASON_CODES.infraFailed:
    case PR_REVIEW_REASON_CODES.checkRunFailed:
    case PR_REVIEW_REASON_CODES.timelineCommentFailed:
    case PR_REVIEW_REASON_CODES.commentPostFailed:
    case PR_REVIEW_REASON_CODES.githubAuthFailed:
    case PR_REVIEW_REASON_CODES.duplicateHeadSha:
    case PR_REVIEW_REASON_CODES.staleHeadSha:
    case PR_REVIEW_REASON_CODES.skippedDraft:
    case PR_REVIEW_REASON_CODES.skippedBotSynchronize:
      return formatAutomationReasonLabel(normalizedReason, event.metadata);
    default:
      return null;
  }
}
