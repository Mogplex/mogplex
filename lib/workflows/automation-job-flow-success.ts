/**
 * Flow execution success finalization for automation jobs.
 *
 * Handles the success path after flow execution completes: PR review
 * finalization, auto-merge attempts, dispatch events, and memory persistence.
 * Extracted from automation-job-executor-core.ts for modularity.
 */

import { summarizeNodeOutput } from "@/lib/flows/graph";

import {
  AUTOMATION_REASON_CODES,
  PR_REVIEW_REASON_CODES,
} from "@/lib/automation-review";

import { extractPrReviewHarnessResult } from "@/lib/workflows/pr-review-harness";
import type { AutomationModelExecutionMetadata } from "@/lib/workflows/automation-model-execution";
import {
  JOB_RUN_CANCELLED,
  type AutomationAgentResult,
  type AutomationJobRunResult,
  type DispatchLogContext,
  type FlowAutoMergeRequest,
  type JobContext,
  type ReleasedAutomationScope,
} from "@/lib/workflows/automation-job-types";
import {
  hasToolCall,
  normalizeAutomationAssignmentType,
} from "@/lib/workflows/automation-job-utils";
import { buildAutomationExecutionMetadataFields } from "@/lib/workflows/automation-job-metadata";
import { persistAutomationOutcomeMemory } from "@/lib/workflows/automation-job-persistence";
import { resolvePullRequestNumber } from "@/lib/workflows/automation-job-sandbox-actions";
import {
  attemptFlowAutoMerge,
  getAutoMergeHeadBlockReason,
  getPrReviewAutoMergeBlockReason,
} from "@/lib/workflows/automation-job-auto-merge";
import type { PrReviewReporter } from "@/lib/workflows/automation-job-pr-review-reporter";
import type { AutomationJobExecutorDeps } from "@/lib/workflows/automation-job-executor-deps";

/**
 * Parameters for flow success finalization.
 */
export type FlowSuccessFinalizationInput = {
  jobRunId: string;
  startedAt: string;
  releasedScope: ReleasedAutomationScope;
  context: JobContext;
  finalResult: AutomationAgentResult;
  autoMergeRequest: FlowAutoMergeRequest | null;
  observabilityError?: string | null;
  isPrReview: boolean;
  reporter: PrReviewReporter | null;
  dispatchLogContext: DispatchLogContext;
  githubToken: string;
  deps: Pick<
    AutomationJobExecutorDeps,
    | "getDurationMs"
    | "persistJobSuccess"
    | "recordControlDispatchEvent"
    | "releaseQueuedJobs"
    | "isJobRunCancellationRequested"
  >;
  failJob: (
    message: string,
    failureContext: JobContext,
    failureStartedAt: string,
    inputTokens: number | null,
    outputTokens: number | null,
    execution: AutomationModelExecutionMetadata | null,
    options: { aiCallTelemetryHandled?: boolean }
  ) => Promise<AutomationJobRunResult>;
};

/**
 * Finalize a successful flow execution.
 *
 * Handles PR review completion, auto-merge, dispatch events, and memory.
 */
export async function finalizeFlowSuccess(
  input: FlowSuccessFinalizationInput
): Promise<AutomationJobRunResult> {
  const {
    jobRunId,
    startedAt,
    releasedScope,
    context,
    finalResult,
    autoMergeRequest,
    observabilityError,
    isPrReview,
    reporter,
    dispatchLogContext,
    githubToken,
    deps,
    failJob,
  } = input;

  const reviewHarnessResult = isPrReview
    ? extractPrReviewHarnessResult(finalResult)
    : null;
  const reviewOutcome = reviewHarnessResult?.reviewOutcome ?? null;
  const reviewCommentPosted = isPrReview
    ? hasToolCall(finalResult, "postComment")
    : false;

  if (await deps.isJobRunCancellationRequested(jobRunId)) {
    await deps.releaseQueuedJobs({
      jobRunId,
      releasedScope,
    });
    return {
      success: false,
      error: JOB_RUN_CANCELLED,
      observabilityError: observabilityError ?? null,
    };
  }

  const durationMs = await deps.getDurationMs(startedAt);
  const persisted = await deps.persistJobSuccess({
    jobRunId,
    inputTokens: finalResult.usage?.inputTokens ?? null,
    outputTokens: finalResult.usage?.outputTokens ?? null,
    durationMs,
  });
  if (!persisted) {
    return {
      success: false,
      error: JOB_RUN_CANCELLED,
      observabilityError: observabilityError ?? null,
    };
  }

  if (isPrReview && reporter) {
    const finalizedReview = await reporter.finalizePrReviewSuccess({
      jobRunId,
      result: finalResult,
      reviewHarnessResult,
      reviewOutcome,
      reviewCommentPosted,
      execution: finalResult.execution,
    });
    if (!finalizedReview.ok) {
      return failJob(
        finalizedReview.error,
        context,
        startedAt,
        finalResult.usage?.inputTokens ?? null,
        finalResult.usage?.outputTokens ?? null,
        finalResult.execution ?? null,
        { aiCallTelemetryHandled: true }
      );
    }
    reporter.state.prReviewCompletionReason = finalizedReview.reviewReason;
    // The review check run for this head SHA is completed now, so a
    // repo that requires it can report the PR as clean. expectedHeadSha
    // refuses the merge if commits landed after the reviewed head.
    const autoMergeBlockReason = autoMergeRequest
      ? (getPrReviewAutoMergeBlockReason({
          reviewOutcome,
          requestedPrNumber: autoMergeRequest.prNumber,
          reviewedPrNumber: resolvePullRequestNumber(context.metadata),
        }) ??
        getAutoMergeHeadBlockReason(
          context.metadata,
          autoMergeRequest.prNumber,
          autoMergeRequest.expectedHeadSha
        ))
      : null;
    const autoMerge = autoMergeRequest
      ? autoMergeBlockReason
        ? { merged: false, reason: autoMergeBlockReason }
        : await attemptFlowAutoMerge({
            jobRunId,
            repoFullName: context.repo.full_name,
            prNumber: autoMergeRequest.prNumber,
            githubToken,
            expectedHeadSha: autoMergeRequest.expectedHeadSha,
            commitTitle: autoMergeRequest.commitTitle,
          })
      : null;
    await deps.recordControlDispatchEvent({
      context: dispatchLogContext,
      jobRunId,
      outcome: "completed",
      reason: finalizedReview.reviewReason,
      metadata: {
        ...finalizedReview.metadata,
        ...(autoMerge ? { auto_merge: autoMerge } : {}),
      },
    });
  } else {
    // Non-pr_review jobs never create a review check run, so there is
    // nothing to wait for before honoring the merge request.
    const autoMergeBlockReason = autoMergeRequest
      ? getAutoMergeHeadBlockReason(
          context.metadata,
          autoMergeRequest.prNumber,
          autoMergeRequest.expectedHeadSha
        )
      : null;
    const autoMerge = autoMergeRequest
      ? autoMergeBlockReason
        ? { merged: false, reason: autoMergeBlockReason }
        : await attemptFlowAutoMerge({
            jobRunId,
            repoFullName: context.repo.full_name,
            prNumber: autoMergeRequest.prNumber,
            githubToken,
            expectedHeadSha: autoMergeRequest.expectedHeadSha,
            commitTitle: autoMergeRequest.commitTitle,
          })
      : null;
    await deps.recordControlDispatchEvent({
      context: dispatchLogContext,
      jobRunId,
      outcome: "completed",
      reason: AUTOMATION_REASON_CODES.completed,
      metadata: {
        automation_output_summary: summarizeNodeOutput(finalResult.text),
        ...buildAutomationExecutionMetadataFields(finalResult.execution),
        ...(autoMerge ? { auto_merge: autoMerge } : {}),
      },
    });
  }

  await persistAutomationOutcomeMemory({
    context,
    jobRunId,
    outcome: "completed",
    summary: `${normalizeAutomationAssignmentType(
      context.assignmentType
    )}: ${summarizeNodeOutput(finalResult.text)}`,
    reason: isPrReview
      ? (reporter?.state.prReviewCompletionReason ??
        (reviewOutcome?.hasIssues
          ? PR_REVIEW_REASON_CODES.posted
          : PR_REVIEW_REASON_CODES.noFindings))
      : AUTOMATION_REASON_CODES.completed,
    execution: finalResult.execution ?? null,
  });
  await deps.releaseQueuedJobs({
    jobRunId,
    releasedScope,
  });

  return {
    success: true,
    output: finalResult.text,
    observabilityError: observabilityError ?? null,
  };
}
