/**
 * Automation job failure handling logic.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import {
  classifyAutomationFailureReason,
  formatAutomationReasonLabel,
  isPrReviewSourceType,
} from "@/lib/automation-review";
import type { AutomationModelExecutionMetadata } from "@/lib/workflows/automation-model-execution";
import type {
  AutomationJobModelFailureDiagnostics,
  JobContext,
  JobRunRuntimeDetails,
  ReleasedAutomationScope,
  ResolvedFlowDefinition,
} from "./automation-job-types";
import { JOB_RUN_CANCELLED } from "./automation-job-types";
import { normalizeAutomationAssignmentType } from "./automation-job-utils";
import {
  buildAutomationJobModelFailureDiagnostics,
  buildAutomationRuntimeMetadataFields,
  buildAutomationExecutionMetadataFields,
  resolveAutomationAiCallUsage,
} from "./automation-job-metadata";
import {
  buildAutomationFailureDisplayMessage,
  buildPrReviewFailureDetails,
  classifyPrReviewFailureReason,
} from "./automation-job-failure-messages";
import { buildDispatchLogContext } from "./automation-job-dispatch";
import type { PrReviewReporter } from "./automation-job-pr-review-reporter";
import { persistAutomationOutcomeMemory } from "./automation-job-persistence";
import type {
  getDurationMs,
  persistJobFailure,
  tryLogAiCall,
} from "./automation-job-persistence";
import type { recordControlDispatchEvent } from "./automation-job-dispatch";
import type { releaseQueuedJobs } from "./automation-job-context-resolution";

/**
 * Dependencies required by the failure handler.
 */
export type FailureHandlerDeps = {
  getDurationMs: typeof getDurationMs;
  persistJobFailure: typeof persistJobFailure;
  recordControlDispatchEvent: typeof recordControlDispatchEvent;
  releaseQueuedJobs: typeof releaseQueuedJobs;
  tryLogAiCall: typeof tryLogAiCall;
};

/**
 * Input to handle an automation job failure.
 */
export type HandleAutomationJobFailureInput = {
  message: string;
  jobRunId: string;
  startedAt: string;
  releasedScope: ReleasedAutomationScope;
  deps: FailureHandlerDeps;
  context: JobContext;
  failureContext?: JobContext;
  failureStartedAt?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  execution?: AutomationModelExecutionMetadata | null;
  toolCalls?: Array<{
    name: string;
    input?: unknown;
    output?: unknown;
    input_preview?: string;
    output_preview?: string;
  }>;
  aiCallTelemetryHandled?: boolean;
  isPrReview: boolean;
  runtime: JobRunRuntimeDetails | null;
  resolvedFlow: ResolvedFlowDefinition | null;
  reporter: PrReviewReporter | null;
};

export type HandleAutomationJobFailureResult = {
  success: false;
  error: string;
  observabilityError: string | null;
  modelFailure?: AutomationJobModelFailureDiagnostics;
};

/**
 * Handles an automation job failure by publishing status surfaces,
 * persisting the failure, recording dispatch events, and cleaning up.
 */
export async function handleAutomationJobFailure(
  input: HandleAutomationJobFailureInput
): Promise<HandleAutomationJobFailureResult> {
  const {
    message,
    jobRunId,
    startedAt,
    releasedScope,
    deps,
    context,
    isPrReview,
    runtime,
    resolvedFlow,
    reporter,
  } = input;
  const failureContext = input.failureContext ?? context;
  const failureStartedAt = input.failureStartedAt ?? startedAt;
  const inputTokens = input.inputTokens ?? null;
  const outputTokens = input.outputTokens ?? null;
  const execution = input.execution ?? null;
  const toolCalls = input.toolCalls;
  const aiCallTelemetryHandled = input.aiCallTelemetryHandled ?? false;

  const genericFailureReason = classifyAutomationFailureReason({
    message,
    execution,
  });
  const reviewFailureReason = isPrReview
    ? classifyPrReviewFailureReason(message, execution)
    : null;
  const displayMessage = buildAutomationFailureDisplayMessage({
    message,
    assignmentType: failureContext.assignmentType,
    execution,
    runtime,
  });
  const modelFailure = buildAutomationJobModelFailureDiagnostics(execution);
  const reviewFailureDetails = isPrReview
    ? buildPrReviewFailureDetails({
        reason: reviewFailureReason ?? genericFailureReason,
        message: displayMessage,
        rawMessage: message,
        execution,
        runtime,
      })
    : null;

  if (isPrReview && reporter) {
    // Failure updates the status surfaces only; native GitHub reviews are
    // reserved for successful review findings with inline anchors.
    await reporter.publishPrReviewCheckRun({
      reviewHarnessResult: null,
      reviewOutcome: null,
      fallbackText: displayMessage,
      conclusion: "failure",
      failureDetails: reviewFailureDetails,
    });
    await reporter.publishPrReviewTimelineComment({
      reviewHarnessResult: null,
      reviewOutcome: null,
      fallbackText: displayMessage,
      conclusion: "failure",
      failureDetails: reviewFailureDetails,
    });
  }

  const durationMs = await deps.getDurationMs(startedAt);
  const failureDurationMs = Date.now() - new Date(failureStartedAt).getTime();
  const persisted = await deps.persistJobFailure({
    jobRunId,
    error: displayMessage,
    durationMs,
  });
  if (!persisted) {
    return {
      success: false,
      error: JOB_RUN_CANCELLED,
      observabilityError: null,
    };
  }

  const failureDispatchContext = buildDispatchLogContext({
    releasedScope,
    context: failureContext,
    resolvedFlow,
  });
  const reporterState = reporter?.state;
  const genericFailureMetadata = {
    error: displayMessage,
    review_timeline_comment_posted:
      reporterState?.reviewTimelineCommentPublished ?? false,
    review_timeline_comment_id: reporterState?.reviewTimelineCommentId ?? null,
    review_timeline_comment_url:
      reporterState?.reviewTimelineCommentUrl ?? null,
    review_timeline_comment_error:
      reporterState?.reviewTimelineCommentError ?? null,
    review_github_review_posted:
      reporterState?.reviewGithubReviewPublished ?? false,
    review_github_review_id: reporterState?.reviewGithubReviewId ?? null,
    review_github_review_url: reporterState?.reviewGithubReviewUrl ?? null,
    review_github_review_error: reporterState?.reviewGithubReviewError ?? null,
    review_github_inline_comments_count:
      reporterState?.reviewGithubInlineCommentCount ?? 0,
    review_check_run_id: reporterState?.reviewCheckRunId ?? null,
    review_check_run_url: reporterState?.reviewCheckRunUrl ?? null,
    review_check_run_completed: reporterState?.reviewCheckRunCompleted ?? false,
    review_check_run_conclusion:
      reporterState?.reviewCheckRunConclusion ?? null,
    review_check_run_error: reporterState?.reviewCheckRunError ?? null,
    ...buildAutomationRuntimeMetadataFields(runtime),
    ...buildAutomationExecutionMetadataFields(execution),
  };
  const usePrReviewFailureReason =
    reviewFailureReason &&
    isPrReviewSourceType(failureDispatchContext.sourceType);
  await deps.recordControlDispatchEvent({
    context: failureDispatchContext,
    jobRunId,
    outcome: "failed",
    reason: usePrReviewFailureReason
      ? reviewFailureReason
      : genericFailureReason,
    metadata: usePrReviewFailureReason
      ? {
          review_outcome: reviewFailureReason,
          review_outcome_label:
            formatAutomationReasonLabel(reviewFailureReason),
          ...genericFailureMetadata,
        }
      : genericFailureMetadata,
  });
  await persistAutomationOutcomeMemory({
    context: failureContext,
    jobRunId,
    outcome: "failed",
    summary: `${normalizeAutomationAssignmentType(
      failureContext.assignmentType
    )} failed: ${displayMessage.slice(0, 240)}`,
    reason: usePrReviewFailureReason
      ? reviewFailureReason
      : genericFailureReason,
    execution,
  });

  // Failed flow nodes record their own ai_calls row. Creating an additional
  // job-level row would duplicate usage and cost. Failures that happen
  // outside node model telemetry still rely on this outer write.
  let observabilityError: string | null = null;
  if (!aiCallTelemetryHandled) {
    const loggedUsage = resolveAutomationAiCallUsage({
      inputTokens,
      outputTokens,
      execution,
    });
    observabilityError = await deps.tryLogAiCall({
      context: failureContext,
      jobRunId,
      status: "failed",
      startedAt: failureStartedAt,
      durationMs: Math.max(failureDurationMs, 0),
      inputTokens: loggedUsage.inputTokens,
      outputTokens: loggedUsage.outputTokens,
      error: displayMessage,
      execution,
      toolCalls,
    });
  }
  await deps.releaseQueuedJobs({
    jobRunId,
    releasedScope,
  });
  return {
    success: false,
    error: displayMessage,
    observabilityError,
    ...(modelFailure ? { modelFailure } : {}),
  };
}
