import { describe, expect, it } from "vitest";
import { PR_REVIEW_REASON_CODES } from "@/lib/automation-review";
import { getPrReviewAutoMergeBlockReason } from "./automation-job-auto-merge";
import {
  finalizePrReviewSuccess,
  type FinalizePrReviewSuccessContext,
} from "./automation-job-pr-review-finalize";
import type { PrReviewReporterState } from "./automation-job-pr-review-reporter";
import type { JobContext } from "./automation-job-types";
import {
  extractPrReviewHarnessResult,
  isPrReviewVerdictMissing,
} from "./pr-review-harness-extraction";
import {
  buildPrReviewCheckTitle,
  buildPrReviewContractNote,
  buildPrReviewStatusHeading,
} from "./pr-review-harness-formatting";
import { buildPrReviewTimelineCommentBody } from "./pr-review-harness";
import type { PrReviewConclusion } from "./pr-review-harness-types";

/** The reviewer read the PR, wrote a closing message, and never reported. */
const unreported = {
  text: "Reviewed the PR. No blockers; noted a 20s timeout on the shell path.",
  steps: [
    {
      toolCalls: [{ toolName: "getPullRequest", input: {} }],
      toolResults: [{}],
    },
  ],
};

const reportedClean = {
  text: "Done.",
  steps: [
    {
      toolCalls: [
        {
          toolName: "reportReview",
          input: { hasIssues: false, summary: "Nothing to fix.", findings: [] },
        },
      ],
      toolResults: [{}],
    },
  ],
};

const commentedOnly = {
  text: "Left a comment.",
  steps: [
    {
      toolCalls: [{ toolName: "postComment", input: { body: "This leaks." } }],
      toolResults: [{}],
    },
  ],
};

describe("isPrReviewVerdictMissing", () => {
  it("should be true when the reviewer finished without filing its report", () => {
    const result = extractPrReviewHarnessResult(unreported);

    expect(result.source).toBe("legacy_text");
    expect(isPrReviewVerdictMissing(result)).toBe(true);
  });

  it("should be false for a filed clean report, a legacy comment, and no result", () => {
    expect(
      isPrReviewVerdictMissing(extractPrReviewHarnessResult(reportedClean))
    ).toBe(false);
    expect(
      isPrReviewVerdictMissing(extractPrReviewHarnessResult(commentedOnly))
    ).toBe(false);
    expect(isPrReviewVerdictMissing(null)).toBe(false);
  });
});

describe("what a review without a verdict publishes", () => {
  const harnessResult = extractPrReviewHarnessResult(unreported);

  it("should say the review is incomplete, never that no issues were found", () => {
    const heading = buildPrReviewStatusHeading({
      harnessResult,
      conclusion: "neutral",
    });
    const title = buildPrReviewCheckTitle({
      harnessResult,
      conclusion: "neutral",
    });

    expect(heading).toBe("**Status:** Review incomplete");
    expect(title).toBe("Review incomplete");
  });

  it("should still report a filed clean review as clean", () => {
    const clean = extractPrReviewHarnessResult(reportedClean);

    expect(
      buildPrReviewStatusHeading({
        harnessResult: clean,
        conclusion: "success",
      })
    ).toBe("**Status:** No material issues found");
    expect(
      buildPrReviewCheckTitle({ harnessResult: clean, conclusion: "success" })
    ).toBe("No issues found");
  });

  it("should keep the reviewer's closing summary in the posted comment without a clean verdict", () => {
    const body = buildPrReviewTimelineCommentBody({
      harnessResult,
      fallbackText: unreported.text,
      conclusion: "neutral",
    });

    expect(body).toContain("**Status:** Review incomplete");
    expect(body).toContain("noted a 20s timeout on the shell path");
    expect(body).not.toContain("No material issues found");
  });

  it("should tell the reader there is no verdict and to rerun", () => {
    const note = buildPrReviewContractNote("legacy_text");

    expect(note).toMatch(/no verdict/);
    expect(note).toMatch(/Rerun the review/);
  });
});

describe("auto-merge and a review without a verdict", () => {
  const target = { requestedPrNumber: 7, reviewedPrNumber: 7 };

  it("should refuse the merge even though hasIssues defaulted to false", () => {
    const harnessResult = extractPrReviewHarnessResult(unreported);

    const reason = getPrReviewAutoMergeBlockReason({
      ...target,
      reviewOutcome: harnessResult.reviewOutcome,
      verdictMissing: isPrReviewVerdictMissing(harnessResult),
    });

    expect(harnessResult.reviewOutcome.hasIssues).toBe(false);
    expect(reason).toBe("Mogplex review finished without a structured verdict");
  });

  it("should still allow the merge for a filed clean report", () => {
    const harnessResult = extractPrReviewHarnessResult(reportedClean);

    const reason = getPrReviewAutoMergeBlockReason({
      ...target,
      reviewOutcome: harnessResult.reviewOutcome,
      verdictMissing: isPrReviewVerdictMissing(harnessResult),
    });

    expect(reason).toBeNull();
  });
});

function makeFinalizeContext() {
  const published: {
    check: PrReviewConclusion[];
    comment: PrReviewConclusion[];
  } = { check: [], comment: [] };
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
    reviewStaleHeadCheckError: null,
    prReviewCompletionReason: null,
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
    publishPrReviewCheckRun: async (input) => {
      published.check.push(input.conclusion);
      return true;
    },
    publishPrReviewGithubReview: async () => false,
    clearStalePrReviewTimelineComment: async () => true,
    publishPrReviewTimelineComment: async (input) => {
      published.comment.push(input.conclusion);
      return true;
    },
  };
  return { ctx, published };
}

async function finalize(result: typeof unreported) {
  const { ctx, published } = makeFinalizeContext();
  const reviewHarnessResult = extractPrReviewHarnessResult(result);
  const outcome = await finalizePrReviewSuccess(
    {
      jobRunId: "job-1",
      result: { ...result, usage: null },
      reviewHarnessResult,
      reviewOutcome: reviewHarnessResult.reviewOutcome,
      reviewCommentPosted: false,
      execution: null,
    },
    {
      persistJobReviewFindings: async () => ({
        persisted: true,
        count: 0,
        error: null,
      }),
    },
    ctx
  );
  return { outcome, published };
}

describe("finalizePrReviewSuccess and a review without a verdict", () => {
  it("should publish a neutral check and record the review as incomplete", async () => {
    const { outcome, published } = await finalize(unreported);

    expect(published).toEqual({ check: ["neutral"], comment: ["neutral"] });
    expect(outcome).toMatchObject({
      ok: true,
      reviewReason: PR_REVIEW_REASON_CODES.incomplete,
      metadata: { review_outcome_label: "Review incomplete" },
    });
  });

  it("should still publish a passing check for a filed clean report", async () => {
    const { outcome, published } = await finalize(reportedClean);

    expect(published).toEqual({ check: ["success"], comment: ["success"] });
    expect(outcome).toMatchObject({
      ok: true,
      reviewReason: PR_REVIEW_REASON_CODES.noFindings,
    });
  });
});
