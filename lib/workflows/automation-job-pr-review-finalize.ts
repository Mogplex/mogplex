/**
 * PR review success finalization logic.
 * Split from automation-job-pr-review-reporter.ts to stay under line limits.
 */

import {
  formatAutomationReasonLabel,
  PR_REVIEW_REASON_CODES,
} from "@/lib/automation-review";
import type { AutomationModelExecutionMetadata } from "@/lib/workflows/automation-model-execution";
import type { AutomationAgentResult, JobContext } from "./automation-job-types";
import { buildAutomationExecutionMetadataFields } from "./automation-job-metadata";
import type {
  PrReviewConclusion,
  PrReviewFailureDetails,
  PrReviewHarnessResult,
  ReviewOutcome,
} from "./pr-review-harness";
import type { persistJobReviewFindings } from "./automation-job-persistence";
import type { PrReviewReporterState } from "./automation-job-pr-review-reporter";

export type FinalizePrReviewSuccessResult =
  | {
      ok: true;
      reviewReason: string;
      metadata: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
    };

export type FinalizePrReviewSuccessInput = {
  jobRunId: string;
  result: AutomationAgentResult;
  reviewHarnessResult: PrReviewHarnessResult | null;
  reviewOutcome: ReviewOutcome | null;
  reviewCommentPosted: boolean;
  execution: AutomationModelExecutionMetadata | null | undefined;
};

export type FinalizePrReviewSuccessDeps = {
  persistJobReviewFindings: typeof persistJobReviewFindings;
};

export type FinalizePrReviewSuccessContext = {
  context: JobContext;
  reviewHeadSha: string;
  reviewPrNumber: number | null;
  state: PrReviewReporterState;
  loadCurrentPrReviewHeadSha: () => Promise<string | null>;
  completeStalePrReviewCheckRun: (currentHeadSha: string) => Promise<boolean>;
  publishPrReviewCheckRun: (input: {
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
    fallbackText: string | null | undefined;
    conclusion: PrReviewConclusion;
    failureDetails?: PrReviewFailureDetails | null;
  }) => Promise<boolean>;
  publishPrReviewGithubReview: (input: {
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
    conclusion: PrReviewConclusion;
  }) => Promise<boolean>;
  clearStalePrReviewTimelineComment: () => Promise<boolean>;
  publishPrReviewTimelineComment: (input: {
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
    fallbackText: string | null | undefined;
    conclusion: PrReviewConclusion;
    failureDetails?: PrReviewFailureDetails | null;
  }) => Promise<boolean>;
};

/**
 * Finalizes a successful PR review by publishing check runs, reviews, and comments.
 * Handles stale head SHA detection and findings persistence.
 */
export async function finalizePrReviewSuccess(
  input: FinalizePrReviewSuccessInput,
  deps: FinalizePrReviewSuccessDeps,
  ctx: FinalizePrReviewSuccessContext
): Promise<FinalizePrReviewSuccessResult> {
  const {
    context,
    reviewHeadSha,
    reviewPrNumber,
    state,
    loadCurrentPrReviewHeadSha,
    completeStalePrReviewCheckRun,
    publishPrReviewCheckRun,
    publishPrReviewGithubReview,
    clearStalePrReviewTimelineComment,
    publishPrReviewTimelineComment,
  } = ctx;

  const reviewSummary = input.reviewOutcome?.summary ?? input.result.text ?? "";
  const requiresReviewCheckRun = reviewHeadSha.length > 0;
  const reviewConclusion = input.reviewOutcome?.hasIssues
    ? "neutral"
    : "success";
  const currentHeadSha = await loadCurrentPrReviewHeadSha();
  const isStaleHeadSha =
    reviewHeadSha.length > 0 &&
    currentHeadSha !== null &&
    currentHeadSha !== reviewHeadSha;

  if (isStaleHeadSha) {
    const reviewCheckPublished =
      await completeStalePrReviewCheckRun(currentHeadSha);

    if (requiresReviewCheckRun && !reviewCheckPublished) {
      return {
        ok: false,
        error: state.reviewCheckRunError
          ? `GitHub check run publish failed: ${state.reviewCheckRunError}`
          : "GitHub check run publish failed: stale review check run was not completed",
      };
    }

    const reviewReason = PR_REVIEW_REASON_CODES.staleHeadSha;

    return {
      ok: true,
      reviewReason,
      metadata: {
        review_outcome: reviewReason,
        review_outcome_label: formatAutomationReasonLabel(reviewReason),
        review_has_issues: input.reviewOutcome?.hasIssues ?? false,
        review_summary: reviewSummary,
        review_affected_files: input.reviewOutcome?.affectedFiles ?? [],
        review_comment_posted: false,
        review_timeline_comment_posted: false,
        review_timeline_comment_id: null,
        review_timeline_comment_url: null,
        review_timeline_comment_error: null,
        review_github_review_posted: false,
        review_github_review_id: null,
        review_github_review_url: null,
        review_github_review_error: null,
        review_github_inline_comments_count: 0,
        review_check_run_id: state.reviewCheckRunId,
        review_check_run_url: state.reviewCheckRunUrl,
        review_check_run_completed: reviewCheckPublished,
        review_check_run_conclusion: state.reviewCheckRunConclusion,
        review_check_run_error: state.reviewCheckRunError,
        review_findings_persisted: false,
        review_findings_count: 0,
        review_findings_persist_error: null,
        review_head_sha: reviewHeadSha,
        review_current_head_sha: currentHeadSha,
        review_stale_head_check_error: state.reviewStaleHeadCheckError,
        ...buildAutomationExecutionMetadataFields(input.execution),
      },
    };
  }

  const reviewCheckPublished = await publishPrReviewCheckRun({
    reviewHarnessResult: input.reviewHarnessResult,
    reviewOutcome: input.reviewOutcome,
    fallbackText: input.result.text,
    conclusion: reviewConclusion,
  });
  const githubReviewPublished = await publishPrReviewGithubReview({
    reviewHarnessResult: input.reviewHarnessResult,
    reviewOutcome: input.reviewOutcome,
    conclusion: reviewConclusion,
  });
  if (
    input.reviewHarnessResult?.source === "structured" &&
    input.reviewOutcome?.hasIssues &&
    githubReviewPublished
  ) {
    // Native GitHub reviews are the canonical success surface for findings.
    // Remove any older marker comment so the PR shows a single review.
    await clearStalePrReviewTimelineComment();
  }
  const requiresReviewTimelineComment =
    reviewPrNumber != null &&
    (!input.reviewOutcome?.hasIssues || !githubReviewPublished);
  const timelineCommentPublished = requiresReviewTimelineComment
    ? await publishPrReviewTimelineComment({
        reviewHarnessResult: input.reviewHarnessResult,
        reviewOutcome: input.reviewOutcome,
        fallbackText: input.result.text,
        conclusion: reviewConclusion,
      })
    : false;
  let reviewFindingsPersisted = false;
  let reviewFindingsCount: number;
  let reviewFindingsPersistError: string | null = null;

  try {
    const persistedReviewFindings = await deps.persistJobReviewFindings({
      userId: context.repo.user_id,
      jobRunId: input.jobRunId,
      repoId: context.repo.id,
      repoFullName: context.repo.full_name,
      prNumber: reviewPrNumber,
      headSha: reviewHeadSha.length > 0 ? reviewHeadSha : null,
      findings: input.reviewOutcome?.findings ?? [],
    });
    reviewFindingsPersisted = persistedReviewFindings.persisted;
    reviewFindingsCount = persistedReviewFindings.count;
  } catch (error) {
    reviewFindingsPersistError =
      error instanceof Error
        ? error.message
        : "Failed to persist review findings";
    reviewFindingsCount = input.reviewOutcome?.findings.length ?? 0;
    console.error("[automation-job] failed to persist review findings", {
      jobRunId: input.jobRunId,
      repoId: context.repo.id,
      error: reviewFindingsPersistError,
    });
  }

  const publishErrors = [
    requiresReviewCheckRun && !reviewCheckPublished
      ? state.reviewCheckRunError
        ? `GitHub check run publish failed: ${state.reviewCheckRunError}`
        : "GitHub check run publish failed: required check run was not completed"
      : null,
    requiresReviewTimelineComment && !timelineCommentPublished
      ? state.reviewTimelineCommentError
        ? `GitHub timeline comment publish failed: ${state.reviewTimelineCommentError}`
        : "GitHub timeline comment publish failed: required timeline comment was not published"
      : null,
  ].filter(Boolean) as string[];

  if (publishErrors.length > 0) {
    return {
      ok: false,
      error: publishErrors.join("; "),
    };
  }

  const reviewReason = input.reviewOutcome?.hasIssues
    ? PR_REVIEW_REASON_CODES.posted
    : PR_REVIEW_REASON_CODES.noFindings;

  return {
    ok: true,
    reviewReason,
    metadata: {
      review_outcome: reviewReason,
      review_outcome_label: formatAutomationReasonLabel(reviewReason),
      review_has_issues: input.reviewOutcome?.hasIssues ?? false,
      review_summary: reviewSummary,
      review_affected_files: input.reviewOutcome?.affectedFiles ?? [],
      review_comment_posted: input.reviewCommentPosted,
      review_timeline_comment_posted: timelineCommentPublished,
      review_timeline_comment_id: state.reviewTimelineCommentId,
      review_timeline_comment_url: state.reviewTimelineCommentUrl,
      review_timeline_comment_error: state.reviewTimelineCommentError,
      review_github_review_posted: state.reviewGithubReviewPublished,
      review_github_review_id: state.reviewGithubReviewId,
      review_github_review_url: state.reviewGithubReviewUrl,
      review_github_review_error: state.reviewGithubReviewError,
      review_github_inline_comments_count: state.reviewGithubInlineCommentCount,
      review_check_run_id: state.reviewCheckRunId,
      review_check_run_url: state.reviewCheckRunUrl,
      review_check_run_completed: reviewCheckPublished,
      review_check_run_conclusion: state.reviewCheckRunConclusion,
      review_check_run_error: state.reviewCheckRunError,
      review_findings_persisted: reviewFindingsPersisted,
      review_findings_count: reviewFindingsCount,
      review_findings_persist_error: reviewFindingsPersistError,
      ...buildAutomationExecutionMetadataFields(input.execution),
    },
  };
}
