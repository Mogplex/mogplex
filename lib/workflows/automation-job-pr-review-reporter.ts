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
import { publishInlinePrReview } from "./automation-job-pr-review-inline";
import {
  createPrReviewLifecycle,
  type PrReviewThreadsDeps,
} from "./pr-review-lifecycle-runner";
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
  /** Without it, every review is a first review (no thread lifecycle). */
  reviewThreads?: PrReviewThreadsDeps;
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
  /** Findings this run posted as new inline comments. */
  reviewInlineFindings: ReadonlySet<ReviewFinding>;
  /** Earlier threads this run replied to and resolved. */
  reviewThreadsResolved: number;
  reviewStaleHeadCheckError: string | null;
  prReviewCompletionReason: string | null;
};

export type PrReviewReporter = {
  state: PrReviewReporterState;
  loadCurrentPrReviewHeadSha: () => Promise<string | null>;
  /** The context with the previous review's history for the prompt. */
  withReviewHistory: (context: JobContext) => Promise<JobContext>;
  /** Key the report's findings and plan the earlier threads. */
  planReviewThreads: (input: {
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
  }) => void;
  resolveStaleReviewThreads: () => Promise<number>;
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
    reviewThreadsResolved: 0,
    reviewStaleHeadCheckError: null,
    prReviewCompletionReason: null,
  };

  const lifecycle = createPrReviewLifecycle({
    deps: deps.reviewThreads,
    githubToken,
    repoFullName: context.repo.full_name,
    prNumber: isPrReview ? reviewPrNumber : null,
    headSha: reviewHeadSha,
  });
  let plannedFindings: ReviewFinding[] = [];
  let plannedStructured = false;

  const withReviewHistory = async (
    jobContext: JobContext
  ): Promise<JobContext> => {
    const block = await lifecycle.loadHistoryBlock();
    if (!block) return jobContext;
    return {
      ...jobContext,
      metadata: { ...jobContext.metadata, pr_review_history_block: block },
    };
  };

  const planReviewThreads = (planInput: {
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
  }) => {
    plannedStructured = planInput.reviewHarnessResult?.source === "structured";
    plannedFindings = planInput.reviewOutcome?.findings ?? [];
    lifecycle.planThreads(plannedFindings, plannedStructured);
  };

  const resolveStaleReviewThreads = async () => {
    state.reviewThreadsResolved = await lifecycle.resolveThreads();
    return state.reviewThreadsResolved;
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
            links: new Map([
              ...lifecycle.plan.existingThreads,
              ...[...state.reviewInlineFindings].map(
                (finding) => [finding, state.reviewGithubReviewUrl] as const
              ),
            ]),
          },
          resolvedFindings: lifecycle.plan.resolvedFindings.map((prior) => ({
            title: prior.title,
            path: prior.path,
            url: prior.thread?.url ?? null,
          })),
          stateMarker: lifecycle.stateMarker({
            structured: plannedStructured && pubInput.conclusion !== "failure",
            findings: plannedFindings,
            inline: state.reviewInlineFindings,
          }),
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
      console.warn("[automation-job] PR summary comment publish failed", {
        repoFullName: context.repo.full_name,
        prNumber: reviewPrNumber,
        error: state.reviewTimelineCommentError,
      });
      return false;
    }
  };

  const publishPrReviewGithubReview = async (pubInput: {
    reviewHarnessResult: PrReviewHarnessResult | null;
    reviewOutcome: ReviewOutcome | null;
    conclusion: PrReviewConclusion;
  }): Promise<boolean> => {
    if (
      !isPrReview ||
      reviewPrNumber == null ||
      reviewHeadSha.length === 0 ||
      pubInput.reviewHarnessResult?.source !== "structured" ||
      !pubInput.reviewOutcome?.findings.length
    ) {
      return false;
    }
    return publishInlinePrReview({
      deps,
      githubToken,
      repoFullName: context.repo.full_name,
      prNumber: reviewPrNumber,
      headSha: reviewHeadSha,
      state,
      lifecycle,
      harnessResult: pubInput.reviewHarnessResult,
      findings: pubInput.reviewOutcome.findings,
      conclusion: pubInput.conclusion,
    });
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
        planReviewThreads,
        resolveStaleReviewThreads,
      }
    );

  return {
    state,
    loadCurrentPrReviewHeadSha,
    withReviewHistory,
    planReviewThreads,
    resolveStaleReviewThreads,
    completeStalePrReviewCheckRun,
    publishPrReviewCheckRun,
    publishPrReviewTimelineComment,
    publishPrReviewGithubReview,
    finalizePrReviewSuccess: wrappedFinalizePrReviewSuccess,
  };
}
