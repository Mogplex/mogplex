import {
  PR_REVIEW_REASON_CODES,
  formatAutomationReasonLabel,
} from "@/lib/automation-review";
import { classifyAutomationInfrastructureFailure } from "@/lib/workflows/automation-infra-failures";
import type { AutomationModelExecutionMetadata } from "@/lib/workflows/automation-model-execution";
import type { PrReviewFailureDetails } from "@/lib/workflows/pr-review-harness";
import type { JobRunRuntimeDetails } from "@/lib/workflows/automation-job-types";
import {
  formatAutomationStateScopeLabel,
  formatAutomationTimeoutScopeLabel,
  formatFailureDurationLabel,
} from "@/lib/workflows/automation-job-utils";
import { GITHUB_PR_ACCESS_FAILURE_PREFIX } from "@/lib/workflows/automation-job-types";

export function buildAutomationFailureDisplayMessage(input: {
  message: string;
  assignmentType: string;
  execution?: AutomationModelExecutionMetadata | null;
  runtime?: JobRunRuntimeDetails | null;
}) {
  const infraFailure = classifyAutomationInfrastructureFailure(input.message);
  if (infraFailure?.failureClass === "supabase_unavailable") {
    const subject = formatAutomationStateScopeLabel(input.assignmentType);
    return `Supabase was unavailable while recording ${subject} workflow state.`;
  }

  if (infraFailure?.failureClass === "html_error_page") {
    return infraFailure.sanitizedText;
  }

  if (input.execution?.finalFailureClass !== "timeout") {
    return input.message;
  }

  const timeoutBudget =
    typeof input.execution.effectiveTimeoutMs === "number" &&
    Number.isFinite(input.execution.effectiveTimeoutMs) &&
    input.execution.effectiveTimeoutMs > 0
      ? formatFailureDurationLabel(input.execution.effectiveTimeoutMs)
      : null;
  const subject = formatAutomationTimeoutScopeLabel(input.assignmentType);
  return timeoutBudget
    ? `AI provider timed out during ${subject} after ${timeoutBudget}.`
    : `AI provider timed out during ${subject}.`;
}

export function buildPrReviewFailureDetails(input: {
  reason: string | null;
  message: string;
  rawMessage?: string | null;
  execution?: AutomationModelExecutionMetadata | null;
  runtime?: JobRunRuntimeDetails | null;
}): PrReviewFailureDetails | null {
  const infraFailure = classifyAutomationInfrastructureFailure(
    input.rawMessage ?? input.message
  );
  const details: PrReviewFailureDetails = {
    reasonLabel: input.reason
      ? formatAutomationReasonLabel(input.reason)
      : null,
    error: input.message,
    infraFailureClass: infraFailure?.failureClass ?? null,
    infraFailureMessage: infraFailure?.detail ?? null,
    modelFailureClass: input.execution?.finalFailureClass ?? null,
    modelFailureMessage: input.execution?.finalFailureMessage ?? null,
    modelFailureStatusCode: input.execution?.finalFailureStatusCode ?? null,
    modelEffectiveTimeoutMs: input.execution?.effectiveTimeoutMs ?? null,
    modelAttempts: input.execution?.attempts ?? null,
    modelRetryAttempted: input.execution?.retried ?? null,
    modelRetryCount: input.execution?.retryCount ?? null,
    runtimeProvider: input.runtime?.provider ?? null,
    runtimeRunId: input.runtime?.runId ?? null,
  };

  return Object.values(details).some((value) => value != null) ? details : null;
}

export function classifyPrReviewFailureReason(
  message: string,
  execution?: AutomationModelExecutionMetadata | null
) {
  if (message === "NO_GITHUB_CONNECTION") {
    return PR_REVIEW_REASON_CODES.githubAuthFailed;
  }

  if (classifyAutomationInfrastructureFailure(message)) {
    return PR_REVIEW_REASON_CODES.infraFailed;
  }

  if (
    execution?.finalFailureClass === "timeout" ||
    execution?.finalFailureClass === "rate_limited" ||
    execution?.finalFailureClass === "provider_unavailable" ||
    execution?.finalFailureClass === "dependency_unavailable" ||
    execution?.finalFailureClass === "authentication" ||
    execution?.finalFailureClass === "configuration"
  ) {
    return PR_REVIEW_REASON_CODES.infraFailed;
  }

  if (message.startsWith("GitHub check run")) {
    return PR_REVIEW_REASON_CODES.checkRunFailed;
  }

  if (message.startsWith("GitHub timeline comment")) {
    return PR_REVIEW_REASON_CODES.timelineCommentFailed;
  }

  if (message.startsWith("GitHub comment post failed")) {
    return PR_REVIEW_REASON_CODES.commentPostFailed;
  }

  if (message.startsWith(GITHUB_PR_ACCESS_FAILURE_PREFIX)) {
    return PR_REVIEW_REASON_CODES.githubAuthFailed;
  }

  return null;
}

export function buildPrReviewCheckDetailsUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return null;

  return `${appUrl.replace(/\/+$/, "")}/observability`;
}
