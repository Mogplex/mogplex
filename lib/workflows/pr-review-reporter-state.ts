import type { ReviewFinding } from "@/lib/types";

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
  /** The link of each of those comments, where GitHub returned it. */
  reviewInlineCommentUrls: ReadonlyMap<ReviewFinding, string>;
  /** Earlier threads this run replied to and resolved. */
  reviewThreadsResolved: number;
  reviewStaleHeadCheckError: string | null;
  prReviewCompletionReason: string | null;
};

/** The state of a run that has published nothing yet. */
export function createPrReviewReporterState(
  overrides: Partial<PrReviewReporterState> = {}
): PrReviewReporterState {
  return {
    reviewCheckRunId: null,
    reviewCheckRunUrl: null,
    reviewCheckRunCompleted: false,
    reviewCheckRunConclusion: null,
    reviewCheckRunError: null,
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
    reviewInlineCommentUrls: new Map(),
    reviewThreadsResolved: 0,
    reviewStaleHeadCheckError: null,
    prReviewCompletionReason: null,
    ...overrides,
  };
}
