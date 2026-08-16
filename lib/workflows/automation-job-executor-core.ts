/**
 * Core orchestration for automation job execution.
 *
 * Contains runAutomationJob which orchestrates the full job lifecycle:
 * context resolution, reporter creation, failure-handler wiring,
 * agent execution, and success finalization.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import { summarizeNodeOutput } from "@/lib/flows/graph";

import {
  AUTOMATION_REASON_CODES,
  PR_REVIEW_REASON_CODES,
  classifyAutomationFailureReason,
  formatAutomationReasonLabel,
  isPrReviewSourceType,
} from "@/lib/automation-review";

import { extractPrReviewHarnessResult } from "@/lib/workflows/pr-review-harness";
import {
  isAutomationModelExecutionError,
  type AutomationModelExecutionMetadata,
} from "@/lib/workflows/automation-model-execution";
import {
  JOB_RUN_CANCELLED,
  JobRunCancelledError,
  type AutomationJobInput,
  type AutomationJobRunResult,
} from "@/lib/workflows/automation-job-types";
import {
  hasToolCall,
  normalizeAutomationAssignmentType,
} from "@/lib/workflows/automation-job-utils";
import {
  buildAutomationExecutionMetadataFields,
  extractToolCalls,
} from "@/lib/workflows/automation-job-metadata";
import { buildDispatchLogContext } from "@/lib/workflows/automation-job-dispatch";
import { persistAutomationOutcomeMemory } from "@/lib/workflows/automation-job-persistence";
import {
  executeResolvedFlow,
  type FlowExecutorDeps,
} from "@/lib/workflows/automation-job-flow-executor";
import { resolvePullRequestNumber } from "@/lib/workflows/automation-job-sandbox-actions";
import { buildPrReviewCheckDetailsUrl } from "@/lib/workflows/automation-job-failure-messages";
import {
  flowRequestsAutoMerge,
  hydrateFlowPullRequestHeadContext,
} from "@/lib/workflows/automation-job-auto-merge";
import { finalizeFlowSuccess } from "@/lib/workflows/automation-job-flow-success";
import {
  createPrReviewReporter,
  type PrReviewReporter,
} from "@/lib/workflows/automation-job-pr-review-reporter";
import { handleAutomationJobFailure } from "@/lib/workflows/automation-job-failure-handler";
import { supersedeIfVanishedPr } from "@/lib/workflows/automation-job-pr-liveness";
import type { AutomationJobExecutorDeps } from "@/lib/workflows/automation-job-executor-deps";
import { executeAutomationContext } from "@/lib/workflows/automation-job-context-executor";

/**
 * Execute an automation job run with full orchestration.
 *
 * This is the core implementation delegated to by createAutomationJobExecutor.
 */
export async function runAutomationJob(
  deps: AutomationJobExecutorDeps,
  input: AutomationJobInput
): Promise<AutomationJobRunResult> {
  const { startedAt } = input;

  const resolved = await deps.resolveJobContext(input.jobRunId);
  if (!("context" in resolved)) {
    const durationMs = await deps.getDurationMs(startedAt);
    const persisted = await deps.persistJobFailure({
      jobRunId: input.jobRunId,
      error: resolved.error,
      durationMs,
    });
    if (!persisted) {
      return { success: false, error: JOB_RUN_CANCELLED };
    }
    await deps.releaseQueuedJobs({
      jobRunId: input.jobRunId,
      releasedScope: input.releasedScope,
    });
    return { success: false, error: resolved.error };
  }

  let { context } = resolved;
  const runtime = resolved.runtime ?? null;
  const dispatchLogContext = buildDispatchLogContext({
    releasedScope: input.releasedScope,
    context,
    resolvedFlow: resolved.flow ?? null,
  });
  const isPrReview = isPrReviewSourceType(dispatchLogContext.sourceType);
  const githubToken = await deps.resolveGithubToken(context.repo, {
    jobRunId: input.jobRunId,
  });

  if (!githubToken) {
    const durationMs = await deps.getDurationMs(startedAt);
    const persisted = await deps.persistJobFailure({
      jobRunId: input.jobRunId,
      error: "NO_GITHUB_CONNECTION",
      durationMs,
    });
    if (!persisted) {
      return { success: false, error: JOB_RUN_CANCELLED };
    }
    const genericFailureReason = classifyAutomationFailureReason({
      message: "NO_GITHUB_CONNECTION",
    });
    await deps.recordControlDispatchEvent(
      isPrReview
        ? {
            context: dispatchLogContext,
            jobRunId: input.jobRunId,
            outcome: "failed",
            reason: PR_REVIEW_REASON_CODES.githubAuthFailed,
            metadata: {
              review_outcome: PR_REVIEW_REASON_CODES.githubAuthFailed,
              review_outcome_label: formatAutomationReasonLabel(
                PR_REVIEW_REASON_CODES.githubAuthFailed
              ),
            },
          }
        : {
            context: dispatchLogContext,
            jobRunId: input.jobRunId,
            outcome: "failed",
            reason: genericFailureReason,
            metadata: {
              error: "NO_GITHUB_CONNECTION",
            },
          }
    );
    const observabilityError = await deps.tryLogAiCall({
      context,
      jobRunId: input.jobRunId,
      status: "failed",
      startedAt,
      durationMs,
      inputTokens: null,
      outputTokens: null,
      error: "NO_GITHUB_CONNECTION",
    });
    await deps.releaseQueuedJobs({
      jobRunId: input.jobRunId,
      releasedScope: input.releasedScope,
    });
    return {
      success: false,
      error: "NO_GITHUB_CONNECTION",
      observabilityError,
    };
  }

  if (resolved.flow && flowRequestsAutoMerge(resolved.flow.graph)) {
    context = await hydrateFlowPullRequestHeadContext({
      context,
      githubToken,
      loadPullRequestDetails: deps.loadPullRequestDetails,
    });
  }

  // Pre-flight: a PR that already closed or lost its head branch is
  // superseded work — cancel instead of executing and failing on the clone.
  const supersedeJobArgs = {
    deps,
    input,
    context,
    dispatchLogContext,
    githubToken,
  };
  const preflightSuperseded = await supersedeIfVanishedPr(supersedeJobArgs);
  if (preflightSuperseded) return preflightSuperseded;

  const reviewHeadSha =
    isPrReview && typeof context.metadata.head_sha === "string"
      ? context.metadata.head_sha.trim()
      : "";
  const reviewPrNumber = isPrReview
    ? resolvePullRequestNumber(context.metadata)
    : null;
  const reviewCheckDetailsUrl = buildPrReviewCheckDetailsUrl();
  // Create initial check run for PR reviews before reporter is created
  let reviewCheckRunId: number | null = null;
  let reviewCheckRunUrl: string | null = null;
  if (isPrReview && reviewHeadSha.length > 0) {
    try {
      const checkRun = await deps.createPrReviewCheckRun({
        githubToken,
        repoFullName: context.repo.full_name,
        headSha: reviewHeadSha,
        externalId: input.jobRunId,
        detailsUrl: reviewCheckDetailsUrl,
      });
      reviewCheckRunId = checkRun.id;
      reviewCheckRunUrl = checkRun.htmlUrl;
    } catch {
      // Error is captured in reporter state
    }
  }

  // Create the PR review reporter with initial check run state
  // githubToken is guaranteed non-null here — we returned early if it was null above
  const reporter: PrReviewReporter | null = isPrReview
    ? createPrReviewReporter({
        deps: {
          completePrReviewCheckRun: deps.completePrReviewCheckRun,
          createPrReviewGithubReview: deps.createPrReviewGithubReview,
          clearPrReviewTimelineComment: deps.clearPrReviewTimelineComment,
          upsertPrReviewTimelineComment: deps.upsertPrReviewTimelineComment,
          loadPullRequestDetails: deps.loadPullRequestDetails,
          persistJobReviewFindings: deps.persistJobReviewFindings,
        },
        context,
        githubToken: githubToken!,
        reviewHeadSha,
        reviewPrNumber,
        isPrReview,
        reviewCheckDetailsUrl: reviewCheckDetailsUrl ?? "",
        reviewCheckRunId,
        reviewCheckRunUrl,
      })
    : null;

  // Thin wrapper around handleAutomationJobFailure to preserve call-site syntax
  const failJob = async (
    message: string,
    failureContext = context,
    failureStartedAt = startedAt,
    inputTokens: number | null = null,
    outputTokens: number | null = null,
    execution: AutomationModelExecutionMetadata | null = null,
    options: {
      toolCalls?: Array<{
        name: string;
        input?: unknown;
        output?: unknown;
        input_preview?: string;
        output_preview?: string;
      }>;
      aiCallTelemetryHandled?: boolean;
    } = {}
  ) =>
    handleAutomationJobFailure({
      message,
      jobRunId: input.jobRunId,
      startedAt,
      releasedScope: input.releasedScope,
      deps: {
        getDurationMs: deps.getDurationMs,
        persistJobFailure: deps.persistJobFailure,
        recordControlDispatchEvent: deps.recordControlDispatchEvent,
        releaseQueuedJobs: deps.releaseQueuedJobs,
        tryLogAiCall: deps.tryLogAiCall,
      },
      context,
      failureContext,
      failureStartedAt,
      inputTokens,
      outputTokens,
      execution,
      toolCalls: options.toolCalls,
      aiCallTelemetryHandled: options.aiCallTelemetryHandled,
      isPrReview,
      runtime,
      resolvedFlow: resolved.flow ?? null,
      reporter,
    });

  if (resolved.flow) {
    const flowExecution = await executeResolvedFlow({
      jobRunId: input.jobRunId,
      context,
      githubToken,
      resolvedFlow: resolved.flow,
      deps: {
        ...deps,
        executeAutomationContext: (execInput) =>
          executeAutomationContext({
            ...execInput,
            deps,
          }),
      } as FlowExecutorDeps,
    });
    if (!flowExecution.success) {
      if (flowExecution.message === JOB_RUN_CANCELLED) {
        await deps.releaseQueuedJobs({
          jobRunId: input.jobRunId,
          releasedScope: input.releasedScope,
        });
        return {
          success: false,
          error: JOB_RUN_CANCELLED,
          observabilityError: flowExecution.observabilityError,
        };
      }

      const superseded = await supersedeIfVanishedPr(supersedeJobArgs, {
        message: flowExecution.message,
        reviewCheckRunId,
      });
      if (superseded) return superseded;

      const failure = await failJob(
        flowExecution.message,
        flowExecution.context,
        startedAt,
        null,
        null,
        "execution" in flowExecution &&
          flowExecution.execution &&
          typeof flowExecution.execution === "object" &&
          "phase" in flowExecution.execution
          ? (flowExecution.execution as AutomationModelExecutionMetadata)
          : null,
        {
          aiCallTelemetryHandled: flowExecution.aiCallTelemetryHandled === true,
        }
      );
      return {
        ...failure,
        observabilityError:
          failure.observabilityError ?? flowExecution.observabilityError,
      };
    }

    return finalizeFlowSuccess({
      jobRunId: input.jobRunId,
      startedAt,
      releasedScope: input.releasedScope,
      context,
      finalResult: flowExecution.result,
      autoMergeRequest: flowExecution.autoMergeRequest ?? null,
      observabilityError: flowExecution.observabilityError,
      isPrReview,
      reporter,
      dispatchLogContext,
      githubToken,
      deps: {
        getDurationMs: deps.getDurationMs,
        persistJobSuccess: deps.persistJobSuccess,
        recordControlDispatchEvent: deps.recordControlDispatchEvent,
        releaseQueuedJobs: deps.releaseQueuedJobs,
        isJobRunCancellationRequested: deps.isJobRunCancellationRequested,
      },
      failJob,
    });
  }

  let finalResult: Awaited<ReturnType<typeof deps.runAutomationAgent>>;
  try {
    await deps.throwIfJobRunCancelled(input.jobRunId);
    finalResult = await executeAutomationContext({
      jobRunId: input.jobRunId,
      context,
      githubToken,
      deps,
      allowAutofix: false,
    });
  } catch (error) {
    if (error instanceof JobRunCancelledError) {
      await deps.releaseQueuedJobs({
        jobRunId: input.jobRunId,
        releasedScope: input.releasedScope,
      });
      return {
        success: false,
        error: JOB_RUN_CANCELLED,
      };
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    const superseded = await supersedeIfVanishedPr(supersedeJobArgs, {
      message,
      reviewCheckRunId,
    });
    if (superseded) return superseded;
    return failJob(
      message,
      context,
      startedAt,
      null,
      null,
      isAutomationModelExecutionError(error) ? error.metadata : null
    );
  }

  if (await deps.isJobRunCancellationRequested(input.jobRunId)) {
    await deps.releaseQueuedJobs({
      jobRunId: input.jobRunId,
      releasedScope: input.releasedScope,
    });
    return {
      success: false,
      error: JOB_RUN_CANCELLED,
    };
  }

  const durationMs = await deps.getDurationMs(startedAt);
  const inputTokens = finalResult.usage?.inputTokens ?? null;
  const outputTokens = finalResult.usage?.outputTokens ?? null;
  const toolCalls = extractToolCalls(finalResult);
  const reviewHarnessResult = isPrReview
    ? extractPrReviewHarnessResult(finalResult)
    : null;
  const reviewOutcome = reviewHarnessResult?.reviewOutcome ?? null;
  const reviewCommentPosted = isPrReview
    ? hasToolCall(finalResult, "postComment")
    : false;

  const persisted = await deps.persistJobSuccess({
    jobRunId: input.jobRunId,
    inputTokens,
    outputTokens,
    durationMs,
  });
  if (!persisted) {
    return {
      success: false,
      error: JOB_RUN_CANCELLED,
    };
  }
  if (isPrReview && reporter) {
    const finalizedReview = await reporter.finalizePrReviewSuccess({
      jobRunId: input.jobRunId,
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
        inputTokens,
        outputTokens,
        finalResult.execution ?? null,
        { toolCalls }
      );
    }
    reporter.state.prReviewCompletionReason = finalizedReview.reviewReason;
    await deps.recordControlDispatchEvent({
      context: dispatchLogContext,
      jobRunId: input.jobRunId,
      outcome: "completed",
      reason: finalizedReview.reviewReason,
      metadata: finalizedReview.metadata,
    });
  } else {
    await deps.recordControlDispatchEvent({
      context: dispatchLogContext,
      jobRunId: input.jobRunId,
      outcome: "completed",
      reason: AUTOMATION_REASON_CODES.completed,
      metadata: {
        automation_output_summary: summarizeNodeOutput(finalResult.text),
        ...buildAutomationExecutionMetadataFields(finalResult.execution),
      },
    });
  }
  await persistAutomationOutcomeMemory({
    context,
    jobRunId: input.jobRunId,
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
  const observabilityError = await deps.tryLogAiCall({
    context,
    jobRunId: input.jobRunId,
    status: "success",
    startedAt,
    durationMs,
    inputTokens,
    outputTokens,
    toolCalls,
    execution: finalResult.execution ?? null,
  });
  await deps.releaseQueuedJobs({
    jobRunId: input.jobRunId,
    releasedScope: input.releasedScope,
  });

  return { success: true, output: finalResult.text, observabilityError };
}
