import { describe, expect, it } from "vitest";
import {
  finalizePrReviewSuccess,
  type FinalizePrReviewSuccessContext,
} from "./automation-job-pr-review-finalize";
import type { PrReviewReporterState } from "./automation-job-pr-review-reporter";
import type { JobContext } from "./automation-job-types";
import { extractPrReviewHarnessResult } from "./pr-review-harness-extraction";

const reportedWarning = {
  text: "Done.",
  steps: [
    {
      toolCalls: [
        {
          toolName: "reportReview",
          input: {
            hasIssues: false,
            summary: "One warning.",
            findings: [
              {
                severity: "warning",
                title: "Unchecked null",
                body: "Body.",
                path: "src/a.ts",
                line: 3,
              },
            ],
          },
        },
      ],
      toolResults: [{}],
    },
  ],
};

async function finalize(options: { nativeReviewPublished: boolean }) {
  const state: PrReviewReporterState = {
    reviewCheckRunId: 1,
    reviewCheckRunUrl: null,
    reviewCheckRunCompleted: false,
    reviewCheckRunConclusion: null,
    reviewCheckRunError: null,
    reviewTimelineCommentPublished: false,
    reviewTimelineCommentId: null,
    reviewTimelineCommentUrl: null,
    reviewTimelineCommentError: "GitHub is down",
    reviewGithubReviewPublished: false,
    reviewGithubReviewId: null,
    reviewGithubReviewUrl: null,
    reviewGithubReviewError: null,
    reviewGithubInlineCommentCount: 0,
    reviewInlineFindings: new Set(),
    reviewStaleHeadCheckError: null,
    prReviewCompletionReason: null,
  };
  let summaryAttempts = 0;
  const ctx: FinalizePrReviewSuccessContext = {
    context: {
      metadata: {},
      assignmentType: "pr_review",
      skillId: null,
      agent: { model: "model", system_prompt: null },
      repo: { id: "repo-1", user_id: "user-1", full_name: "acme/widgets" },
    } satisfies JobContext,
    reviewHeadSha: "abc123",
    reviewPrNumber: 7,
    state,
    loadCurrentPrReviewHeadSha: async () => "abc123",
    completeStalePrReviewCheckRun: async () => true,
    publishPrReviewCheckRun: async () => true,
    publishPrReviewGithubReview: async () => {
      state.reviewGithubReviewPublished = options.nativeReviewPublished;
      return options.nativeReviewPublished;
    },
    publishPrReviewTimelineComment: async () => {
      summaryAttempts += 1;
      return false;
    },
  };
  const reviewHarnessResult = extractPrReviewHarnessResult(reportedWarning);
  const outcome = await finalizePrReviewSuccess(
    {
      jobRunId: "job-1",
      result: { ...reportedWarning, usage: null },
      reviewHarnessResult,
      reviewOutcome: reviewHarnessResult.reviewOutcome,
      reviewCommentPosted: false,
      execution: null,
    },
    {
      persistJobReviewFindings: async () => ({
        persisted: true,
        count: 1,
        error: null,
      }),
    },
    ctx
  );
  return { outcome, summaryAttempts };
}

describe("finalizePrReviewSuccess and the summary comment", () => {
  it("should not fail the run when the summary fails after the inline review published", async () => {
    const { outcome, summaryAttempts } = await finalize({
      nativeReviewPublished: true,
    });

    expect(summaryAttempts).toBe(1);
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.metadata.review_verdict).toBe("blocking");
  });

  it("should fail the run when the summary is the only place the review landed", async () => {
    const { outcome } = await finalize({ nativeReviewPublished: false });

    expect(outcome).toMatchObject({
      ok: false,
      error: expect.stringContaining("GitHub timeline comment publish failed"),
    });
  });
});
