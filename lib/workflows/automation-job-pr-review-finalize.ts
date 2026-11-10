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
import { isPrReviewVerdictMissing } from "./pr-review-harness-extraction";
import {
  prReviewVerdict,
  prReviewVerdictConclusion,
} from "./pr-review-harness-formatting";
import type { persistJobReviewFindings } from "./automation-job-persistence";
import type { PrReviewReporterState } from "./automation-job-pr-review-reporter";
import {
  polishPrReviewForPublish,
  prReviewDecisionScope,
} from "./pr-review-format-check";

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
  /** Defaults to the platform format check; tests pass their own. */
  polishPrReviewForPublish?: typeof polishPrReviewForPublish;
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
  publishPrReviewTimelineComment: (input: {
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
    fallbackText: string | null | undefined;
    conclusion: PrReviewConclusion;
    failureDetails?: PrReviewFailureDetails | null;
  }) => Promise<boolean>;
  /** Thread lifecycle hooks; without them every review is a first review. */
  planReviewThreads?: (input: {
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
  }) => void;
  resolveStaleReviewThreads?: () => Promise<number>;
  /** True when a newer run on this PR already published its review. */
  isSupersededByNewerReview?: () => Promise<boolean>;
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
    publishPrReviewTimelineComment,
    planReviewThreads,
    resolveStaleReviewThreads,
    isSupersededByNewerReview,
  } = ctx;

  const reviewSummary = input.reviewOutcome?.summary ?? input.result.text ?? "";
  const requiresReviewCheckRun = reviewHeadSha.length > 0;
  // A run that never filed its report has no verdict, so its check must not
  // turn green: a required check would otherwise pass a PR nobody reviewed.
  // Findings decide the rest: critical or warning findings need attention,
  // suggestions alone do not.
  const verdictMissing = isPrReviewVerdictMissing(input.reviewHarnessResult);
  const reviewVerdict = prReviewVerdict(
    input.reviewHarnessResult ??
      (input.reviewOutcome
        ? {
            source: "structured",
            fallbackText: null,
            reviewOutcome: input.reviewOutcome,
          }
        : null)
  );
  const reviewConclusion = prReviewVerdictConclusion(reviewVerdict);
  // A run that does not publish its review: the PR moved on, or a newer
  // run already published. Only its check run is completed.
  const unpublishedReview = (
    reviewReason: string,
    published: { reviewCheckPublished: boolean; currentHeadSha: string | null }
  ): FinalizePrReviewSuccessResult => {
    const { reviewCheckPublished, currentHeadSha } = published;
    return {
      ok: true,
      reviewReason,
      metadata: {
        review_outcome: reviewReason,
        review_outcome_label: formatAutomationReasonLabel(reviewReason),
        review_has_issues: input.reviewOutcome?.hasIssues ?? false,
        review_verdict: reviewVerdict,
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
  };
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

    return unpublishedReview(PR_REVIEW_REASON_CODES.staleHeadSha, {
      reviewCheckPublished,
      currentHeadSha,
    });
  }

  // Every surface below publishes the same checked text.
  const publishedHarnessResult = await (
    deps.polishPrReviewForPublish ?? polishPrReviewForPublish
  )(
    input.reviewHarnessResult,
    prReviewDecisionScope(context, input.result.aiCallId ?? null),
    { job_run_id: input.jobRunId, pr_number: reviewPrNumber }
  );
  const publishedOutcome =
    publishedHarnessResult === input.reviewHarnessResult
      ? input.reviewOutcome
      : (publishedHarnessResult?.reviewOutcome ?? input.reviewOutcome);

  const reviewCheckPublished = await publishPrReviewCheckRun({
    reviewHarnessResult: publishedHarnessResult,
    reviewOutcome: publishedOutcome,
    fallbackText: input.result.text,
    conclusion: reviewConclusion,
  });
  // Inline comments go first so the summary comment can link to them. The
  // summary comment is the one canonical review on every run. Findings that
  // already have a thread keep it; threads for findings this review no longer
  // reports are resolved before the summary lists them.
  // Same head, but another run read the PR later and already published:
  // its threads and state are newer than this run's.
  if (await isSupersededByNewerReview?.()) {
    if (requiresReviewCheckRun && !reviewCheckPublished) {
      return {
        ok: false,
        error: state.reviewCheckRunError
          ? `GitHub check run publish failed: ${state.reviewCheckRunError}`
          : "GitHub check run publish failed: required check run was not completed",
      };
    }
    return unpublishedReview(PR_REVIEW_REASON_CODES.supersededByReview, {
      reviewCheckPublished,
      currentHeadSha,
    });
  }
  planReviewThreads?.({
    reviewHarnessResult: publishedHarnessResult,
    reviewOutcome: publishedOutcome,
  });
  await publishPrReviewGithubReview({
    reviewHarnessResult: publishedHarnessResult,
    reviewOutcome: publishedOutcome,
    conclusion: reviewConclusion,
  });
  await resolveStaleReviewThreads?.();
  // Always published, but only required when no native review carries the
  // findings: a run retried after a failed comment would post the native
  // review a second time.
  const timelineCommentPublished =
    reviewPrNumber == null
      ? false
      : await publishPrReviewTimelineComment({
          reviewHarnessResult: publishedHarnessResult,
          reviewOutcome: publishedOutcome,
          fallbackText: input.result.text,
          conclusion: reviewConclusion,
        });
  const requiresReviewTimelineComment =
    reviewPrNumber != null && !state.reviewGithubReviewPublished;
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
      findings: publishedOutcome?.findings ?? [],
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

  const reviewReason =
    input.reviewOutcome?.hasIssues ||
    (publishedOutcome?.findings.length ?? 0) > 0
      ? PR_REVIEW_REASON_CODES.posted
      : verdictMissing
        ? PR_REVIEW_REASON_CODES.incomplete
        : PR_REVIEW_REASON_CODES.noFindings;

  return {
    ok: true,
    reviewReason,
    metadata: {
      review_outcome: reviewReason,
      review_outcome_label: formatAutomationReasonLabel(reviewReason),
      review_has_issues: input.reviewOutcome?.hasIssues ?? false,
      review_verdict: reviewVerdict,
      review_summary: publishedOutcome?.summary ?? reviewSummary,
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
      review_threads_resolved: state.reviewThreadsResolved,
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
