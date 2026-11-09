/**
 * PR review reporting lifecycle for automation job execution.
 * Manages GitHub check runs, timeline comments, and native GitHub reviews.
 *
 * Extracted from automation-job-workflow.ts for modularity.
 */

import type { AutomationModelExecutionMetadata } from "@/lib/workflows/automation-model-execution";
import type { ReviewFinding } from "@/lib/types";
import type { AutomationAgentResult, JobContext } from "./automation-job-types";
import {
  buildPrReviewCheckText,
  buildPrReviewCheckSummary,
  buildPrReviewCheckTitle,
  buildPrReviewGithubReviewBody,
  buildPrReviewInlineComments,
  buildPrReviewTimelineCommentBody,
  type PrReviewConclusion,
  type PrReviewFailureDetails,
  type PrReviewHarnessResult,
  type ReviewOutcome,
} from "./pr-review-harness";
import type {
  completePrReviewCheckRun,
  createPrReviewGithubReview,
  loadPullRequestChangedLines,
  upsertPrReviewTimelineComment,
} from "@/lib/github-check-runs";
import { anchorReviewFindings } from "./pr-review-anchors";
import type { loadPullRequestDetails } from "./automation-job-github";
import type { persistJobReviewFindings } from "./automation-job-persistence";
import type { polishPrReviewForPublish } from "./pr-review-format-check";
import {
  finalizePrReviewSuccess,
  type FinalizePrReviewSuccessResult,
} from "./automation-job-pr-review-finalize";

/**
 * Dependencies required by the PR review reporter.
 * Subset of AutomationJobExecutorDeps relevant to review publishing.
 */
export type PrReviewReporterDeps = {
  completePrReviewCheckRun: typeof completePrReviewCheckRun;
  createPrReviewGithubReview: typeof createPrReviewGithubReview;
  /** Without it, inline comments go only on the lines findings name. */
  loadPullRequestChangedLines?: typeof loadPullRequestChangedLines;
  upsertPrReviewTimelineComment: typeof upsertPrReviewTimelineComment;
  loadPullRequestDetails: typeof loadPullRequestDetails;
  persistJobReviewFindings: typeof persistJobReviewFindings;
  polishPrReviewForPublish?: typeof polishPrReviewForPublish;
};

/**
 * Input to create a PR review reporter instance.
 */
export type PrReviewReporterInput = {
  deps: PrReviewReporterDeps;
  context: JobContext;
  githubToken: string;
  reviewHeadSha: string;
  reviewPrNumber: number | null;
  isPrReview: boolean;
  reviewCheckDetailsUrl: string;
  reviewCheckRunId: number | null;
  reviewCheckRunUrl: string | null;
  reviewCheckRunError?: string | null;
};

/**
 * Mutable state tracked during the review reporting lifecycle.
 * Exposed via a state object so the executor can read current values.
 */
export type PrReviewReporterState = {
  reviewCheckRunId: number | null;
  reviewCheckRunUrl: string | null;
  reviewCheckRunCompleted: boolean;
  reviewCheckRunConclusion: "success" | "neutral" | "failure" | null;
  reviewCheckRunError: string | null;
  reviewTimelineCommentPublished: boolean;
  reviewTimelineCommentId: number | null;
  reviewTimelineCommentUrl: string | null;
  reviewTimelineCommentError: string | null;
  reviewGithubReviewPublished: boolean;
  reviewGithubReviewId: number | null;
  reviewGithubReviewUrl: string | null;
  reviewGithubReviewError: string | null;
  reviewGithubInlineCommentCount: number;
  /** Findings the native review carries as inline comments. */
  reviewInlineFindings: ReadonlySet<ReviewFinding>;
  reviewStaleHeadCheckError: string | null;
  prReviewCompletionReason: string | null;
};

export type PrReviewReporter = {
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
  publishPrReviewTimelineComment: (input: {
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
  finalizePrReviewSuccess: (input: {
    jobRunId: string;
    result: AutomationAgentResult;
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
    reviewCommentPosted: boolean;
    execution: AutomationModelExecutionMetadata | null | undefined;
  }) => Promise<FinalizePrReviewSuccessResult>;
};

// Re-export the result type for consumers
export type { FinalizePrReviewSuccessResult } from "./automation-job-pr-review-finalize";

/**
 * Creates a PR review reporter instance that manages the review reporting lifecycle.
 * The returned object exposes both methods and a mutable state object that the
 * executor can read to access current values (e.g., reviewCheckRunCompleted).
 */
export function createPrReviewReporter(
  input: PrReviewReporterInput
): PrReviewReporter {
  const {
    deps,
    context,
    githubToken,
    reviewHeadSha,
    reviewPrNumber,
    isPrReview,
    reviewCheckDetailsUrl,
  } = input;

  // Mutable state object — methods mutate this, executor reads from it
  const state: PrReviewReporterState = {
    reviewCheckRunId: input.reviewCheckRunId,
    reviewCheckRunUrl: input.reviewCheckRunUrl,
    reviewCheckRunCompleted: false,
    reviewCheckRunConclusion: null,
    reviewCheckRunError: input.reviewCheckRunError ?? null,
    reviewTimelineCommentPublished: false,
    reviewTimelineCommentId: null,
    reviewTimelineCommentUrl: null,
    reviewTimelineCommentError: null,
    reviewGithubReviewPublished: false,
    reviewGithubReviewId: null,
    reviewGithubReviewUrl: null,
    reviewGithubReviewError: null,
    reviewGithubInlineCommentCount: 0,
    reviewInlineFindings: new Set(),
    reviewStaleHeadCheckError: null,
    prReviewCompletionReason: null,
  };

  const loadCurrentPrReviewHeadSha = async (): Promise<string | null> => {
    if (!isPrReview || reviewPrNumber == null || reviewHeadSha.length === 0) {
      return null;
    }

    try {
      const pullRequest = await deps.loadPullRequestDetails({
        repoFullName: context.repo.full_name,
        prNumber: reviewPrNumber,
        githubToken,
        fallbackHeadRef:
          typeof context.metadata.head_ref === "string"
            ? context.metadata.head_ref
            : null,
        fallbackHeadSha: reviewHeadSha,
        fallbackHeadRepoFullName:
          typeof context.metadata.head_repo_full_name === "string"
            ? context.metadata.head_repo_full_name
            : null,
        fallbackBaseRef:
          typeof context.metadata.base_ref === "string"
            ? context.metadata.base_ref
            : null,
        fallbackBaseSha:
          typeof context.metadata.base_sha === "string"
            ? context.metadata.base_sha
            : null,
        fallbackBaseRepoFullName:
          typeof context.metadata.base_repo_full_name === "string"
            ? context.metadata.base_repo_full_name
            : null,
      });
      const currentHeadSha = pullRequest?.headSha?.trim() || null;
      state.reviewStaleHeadCheckError = null;
      return currentHeadSha;
    } catch (error) {
      state.reviewStaleHeadCheckError =
        error instanceof Error
          ? error.message
          : "Failed to load current PR head SHA";
      return null;
    }
  };

  const completeStalePrReviewCheckRun = async (
    currentHeadSha: string
  ): Promise<boolean> => {
    if (!state.reviewCheckRunId) return false;

    const summary = `Mogplex skipped publishing this review because the PR head changed from ${reviewHeadSha} to ${currentHeadSha}.`;

    try {
      const updatedCheckRun = await deps.completePrReviewCheckRun({
        githubToken,
        repoFullName: context.repo.full_name,
        checkRunId: state.reviewCheckRunId,
        conclusion: "success",
        title: "Review skipped",
        summary,
        text: summary,
        detailsUrl: reviewCheckDetailsUrl,
      });
      state.reviewCheckRunCompleted = true;
      state.reviewCheckRunConclusion = "success";
      state.reviewCheckRunUrl =
        updatedCheckRun.htmlUrl ?? state.reviewCheckRunUrl;
      state.reviewCheckRunError = null;
      return true;
    } catch (error) {
      state.reviewCheckRunError =
        error instanceof Error
          ? error.message
          : "Failed to update GitHub check run";
      return false;
    }
  };

  const publishPrReviewCheckRun = async (pubInput: {
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
    fallbackText: string | null | undefined;
    conclusion: PrReviewConclusion;
    failureDetails?: PrReviewFailureDetails | null;
  }): Promise<boolean> => {
    if (!state.reviewCheckRunId) return false;
    if (
      state.reviewCheckRunCompleted &&
      state.reviewCheckRunConclusion === pubInput.conclusion
    )
      return true;

    try {
      const summary = buildPrReviewCheckSummary({
        harnessResult: pubInput.reviewHarnessResult,
        fallbackText: pubInput.fallbackText,
        conclusion: pubInput.conclusion,
        failureDetails: pubInput.failureDetails,
      });
      const updatedCheckRun = await deps.completePrReviewCheckRun({
        githubToken,
        repoFullName: context.repo.full_name,
        checkRunId: state.reviewCheckRunId,
        conclusion: pubInput.conclusion,
        title: buildPrReviewCheckTitle({
          harnessResult: pubInput.reviewHarnessResult,
          conclusion: pubInput.conclusion,
        }),
        summary,
        text: buildPrReviewCheckText({
          harnessResult: pubInput.reviewHarnessResult,
          fallbackText: pubInput.fallbackText,
          conclusion: pubInput.conclusion,
          failureDetails: pubInput.failureDetails,
          shownSummary: summary,
        }),
        detailsUrl: reviewCheckDetailsUrl,
      });
      state.reviewCheckRunCompleted = true;
      state.reviewCheckRunConclusion = pubInput.conclusion;
      state.reviewCheckRunUrl =
        updatedCheckRun.htmlUrl ?? state.reviewCheckRunUrl;
      state.reviewCheckRunError = null;
      return true;
    } catch (error) {
      state.reviewCheckRunError =
        error instanceof Error
          ? error.message
          : "Failed to update GitHub check run";
      return false;
    }
  };

  const publishPrReviewTimelineComment = async (pubInput: {
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
    fallbackText: string | null | undefined;
    conclusion: PrReviewConclusion;
    failureDetails?: PrReviewFailureDetails | null;
  }): Promise<boolean> => {
    if (!isPrReview || reviewPrNumber == null) return false;

    try {
      const comment = await deps.upsertPrReviewTimelineComment({
        githubToken,
        repoFullName: context.repo.full_name,
        prNumber: reviewPrNumber,
        body: buildPrReviewTimelineCommentBody({
          harnessResult: pubInput.reviewHarnessResult,
          fallbackText: pubInput.fallbackText,
          conclusion: pubInput.conclusion,
          checkRunUrl: state.reviewCheckRunUrl,
          failureDetails: pubInput.failureDetails,
          inline: {
            findings: state.reviewInlineFindings,
            reviewUrl: state.reviewGithubReviewUrl,
          },
        }),
      });
      state.reviewTimelineCommentPublished = true;
      state.reviewTimelineCommentId = comment.id;
      state.reviewTimelineCommentUrl = comment.htmlUrl;
      state.reviewTimelineCommentError = null;
      return true;
    } catch (error) {
      state.reviewTimelineCommentError =
        error instanceof Error
          ? error.message
          : "Failed to publish PR timeline comment";
      return false;
    }
  };

  const loadChangedLines = async () => {
    if (!deps.loadPullRequestChangedLines || reviewPrNumber == null)
      return null;
    try {
      return await deps.loadPullRequestChangedLines({
        githubToken,
        repoFullName: context.repo.full_name,
        prNumber: reviewPrNumber,
      });
    } catch (error) {
      // Without the diff, findings keep the lines they name. Logged so a
      // rejected review can be told apart from missing diff data.
      console.warn("[automation-job] PR diff lookup failed", {
        repoFullName: context.repo.full_name,
        prNumber: reviewPrNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  /**
   * Publish the findings that can sit on the diff as one native review of
   * inline comments. Findings it cannot anchor stay in the summary comment,
   * which is published after this and lists the inline ones by link.
   */
  const publishPrReviewGithubReview = async (pubInput: {
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
    conclusion: PrReviewConclusion;
  }): Promise<boolean> => {
    const reviewOutcome = pubInput.reviewOutcome;

    if (
      !isPrReview ||
      reviewPrNumber == null ||
      reviewHeadSha.length === 0 ||
      pubInput.reviewHarnessResult?.source !== "structured" ||
      !reviewOutcome?.findings.length
    ) {
      return false;
    }

    const { comments } = anchorReviewFindings(
      reviewOutcome.findings,
      await loadChangedLines()
    );
    if (comments.length === 0) return false;

    try {
      const review = await deps.createPrReviewGithubReview({
        githubToken,
        repoFullName: context.repo.full_name,
        prNumber: reviewPrNumber,
        commitId: reviewHeadSha,
        body: buildPrReviewGithubReviewBody({
          harnessResult: pubInput.reviewHarnessResult,
          conclusion: pubInput.conclusion,
          checkRunUrl: state.reviewCheckRunUrl,
          inlineCommentCount: comments.length,
        }),
        comments: buildPrReviewInlineComments(comments),
      });
      state.reviewGithubReviewPublished = true;
      state.reviewGithubReviewId = review.id;
      state.reviewGithubReviewUrl = review.htmlUrl;
      state.reviewGithubReviewError = null;
      state.reviewGithubInlineCommentCount = comments.length;
      state.reviewInlineFindings = new Set(
        comments.map((comment) => comment.finding)
      );
      return true;
    } catch (error) {
      // The summary comment then carries every finding in full.
      state.reviewGithubReviewError =
        error instanceof Error ? error.message : "Failed to publish PR review";
      state.reviewGithubInlineCommentCount = 0;
      return false;
    }
  };

  const wrappedFinalizePrReviewSuccess = (finalizeInput: {
    jobRunId: string;
    result: AutomationAgentResult;
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
    reviewCommentPosted: boolean;
    execution: AutomationModelExecutionMetadata | null | undefined;
  }): Promise<FinalizePrReviewSuccessResult> =>
    finalizePrReviewSuccess(
      finalizeInput,
      {
        persistJobReviewFindings: deps.persistJobReviewFindings,
        polishPrReviewForPublish: deps.polishPrReviewForPublish,
      },
      {
        context,
        reviewHeadSha,
        reviewPrNumber,
        state,
        loadCurrentPrReviewHeadSha,
        completeStalePrReviewCheckRun,
        publishPrReviewCheckRun,
        publishPrReviewGithubReview,
        publishPrReviewTimelineComment,
      }
    );

  return {
    state,
    loadCurrentPrReviewHeadSha,
    completeStalePrReviewCheckRun,
    publishPrReviewCheckRun,
    publishPrReviewTimelineComment,
    publishPrReviewGithubReview,
    finalizePrReviewSuccess: wrappedFinalizePrReviewSuccess,
  };
}
