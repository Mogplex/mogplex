import { describe, expect, it, vi } from "vitest";
import { PR_REVIEW_REASON_CODES } from "@/lib/automation-review";
import {
  finalizePrReviewSuccess,
  type FinalizePrReviewSuccessContext,
} from "./automation-job-pr-review-finalize";
import type { PrReviewReporterState } from "./automation-job-pr-review-reporter";
import type { JobContext } from "./automation-job-types";
import { extractPrReviewHarnessResult } from "./pr-review-harness-extraction";

const reported = {
  text: "Done.",
  steps: [
    {
      toolCalls: [
        {
          toolName: "reportReview",
          input: {
            hasIssues: true,
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

async function finalize(superseded: boolean) {
  const state: PrReviewReporterState = {
    reviewCheckRunId: 1,
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
    reviewThreadsResolved: 0,
    reviewStaleHeadCheckError: null,
    prReviewCompletionReason: null,
  };
  const calls = {
    checkRun: vi.fn(async () => true),
    plan: vi.fn(),
    review: vi.fn(async () => true),
    resolve: vi.fn(async () => 0),
    summary: vi.fn(async () => true),
  };
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
    publishPrReviewCheckRun: calls.checkRun,
    publishPrReviewGithubReview: calls.review,
    publishPrReviewTimelineComment: calls.summary,
    planReviewThreads: calls.plan,
    resolveStaleReviewThreads: calls.resolve,
    isSupersededByNewerReview: async () => superseded,
  };
  const reviewHarnessResult = extractPrReviewHarnessResult(reported);
  const outcome = await finalizePrReviewSuccess(
    {
      jobRunId: "job-1",
      result: { ...reported, usage: null },
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
  return { outcome, calls };
}

describe("finalizePrReviewSuccess with a newer review on the same head", () => {
  it("should complete its check run and publish nothing else", async () => {
    const { outcome, calls } = await finalize(true);

    expect(outcome).toMatchObject({
      ok: true,
      reviewReason: PR_REVIEW_REASON_CODES.supersededByReview,
      metadata: {
        review_outcome: PR_REVIEW_REASON_CODES.supersededByReview,
        review_outcome_label: "Superseded by a newer review",
        review_check_run_completed: true,
        review_timeline_comment_posted: false,
      },
    });
    expect(calls.checkRun).toHaveBeenCalledTimes(1);
    for (const skipped of [
      calls.plan,
      calls.review,
      calls.resolve,
      calls.summary,
    ]) {
      expect(skipped).not.toHaveBeenCalled();
    }
  });

  it("should publish everything when no newer review exists", async () => {
    const { outcome, calls } = await finalize(false);

    expect(outcome).toMatchObject({
      ok: true,
      reviewReason: PR_REVIEW_REASON_CODES.posted,
    });
    expect(calls.review).toHaveBeenCalledTimes(1);
    expect(calls.summary).toHaveBeenCalledTimes(1);
  });
});
