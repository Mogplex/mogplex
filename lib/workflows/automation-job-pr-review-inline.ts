import type {
  createPrReviewGithubReview,
  loadPullRequestChangedLines,
} from "@/lib/github-check-runs";
import type { ReviewFinding } from "@/lib/types";
import {
  buildPrReviewGithubReviewBody,
  buildPrReviewInlineComments,
  type PrReviewConclusion,
  type PrReviewHarnessResult,
} from "./pr-review-harness";
import { anchorReviewFindings } from "./pr-review-anchors";
import type { PrReviewLifecycle } from "./pr-review-lifecycle-runner";

export type PrReviewInlineState = {
  reviewCheckRunUrl: string | null;
  reviewGithubReviewPublished: boolean;
  reviewGithubReviewId: number | null;
  reviewGithubReviewUrl: string | null;
  reviewGithubReviewError: string | null;
  reviewGithubInlineCommentCount: number;
  /** Findings this run posted as new inline comments. */
  reviewInlineFindings: ReadonlySet<ReviewFinding>;
};

/**
 * Publish the findings that can sit on the diff as one native review of
 * inline comments. A finding that already has an open thread from an
 * earlier review is not posted again. Each comment carries its finding key
 * so the next review can find the thread. Findings it cannot anchor stay in
 * the summary comment, which is published after this and links the rest.
 */
export async function publishInlinePrReview(input: {
  deps: {
    createPrReviewGithubReview: typeof createPrReviewGithubReview;
    loadPullRequestChangedLines?: typeof loadPullRequestChangedLines;
  };
  githubToken: string;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  state: PrReviewInlineState;
  lifecycle: PrReviewLifecycle;
  harnessResult: PrReviewHarnessResult;
  findings: ReviewFinding[];
  conclusion: PrReviewConclusion;
}): Promise<boolean> {
  const { deps, state, lifecycle } = input;
  const fresh = input.findings.filter(
    (finding) => !lifecycle.plan.existingThreads.has(finding)
  );
  if (fresh.length === 0) return false;

  const changed = deps.loadPullRequestChangedLines
    ? await deps
        .loadPullRequestChangedLines({
          githubToken: input.githubToken,
          repoFullName: input.repoFullName,
          prNumber: input.prNumber,
        })
        // Without the diff, findings keep the lines they name. Logged so a
        // rejected review can be told apart from missing diff data.
        .catch((error: unknown) => {
          console.warn("[automation-job] PR diff lookup failed", {
            repoFullName: input.repoFullName,
            prNumber: input.prNumber,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        })
    : null;
  const { comments } = anchorReviewFindings(fresh, changed);
  if (comments.length === 0) return false;

  try {
    const review = await deps.createPrReviewGithubReview({
      githubToken: input.githubToken,
      repoFullName: input.repoFullName,
      prNumber: input.prNumber,
      commitId: input.headSha,
      body: buildPrReviewGithubReviewBody({
        harnessResult: input.harnessResult,
        conclusion: input.conclusion,
        checkRunUrl: state.reviewCheckRunUrl,
        inlineCommentCount: comments.length,
      }),
      comments: buildPrReviewInlineComments(comments).map((comment, index) => {
        const marker = lifecycle.markerFor(comments[index].finding);
        return marker
          ? { ...comment, body: `${comment.body}\n\n${marker}` }
          : comment;
      }),
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
    // The summary comment then carries every new finding in full.
    state.reviewGithubReviewError =
      error instanceof Error ? error.message : "Failed to publish PR review";
    state.reviewGithubInlineCommentCount = 0;
    return false;
  }
}
