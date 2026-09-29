import { describe, expect, it } from "vitest";
import { getPrReviewAutoMergeBlockReason } from "./automation-job-auto-merge";
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
import { readReviewReportState } from "./pr-review-report-state";

const CLAIM = "One warning and three suggestions, detailed in the comment.";

/** What the SDK hands back for a report whose input failed the schema. */
function rejected(input: Record<string, unknown>) {
  return { toolName: "reportReview", input, invalid: true };
}

function accepted(input: Record<string, unknown>) {
  return { toolName: "reportReview", input };
}

function review(...toolCalls: Array<ReturnType<typeof accepted>>) {
  return { text: "Reviewed.", steps: [{ toolCalls, toolResults: [] }] };
}

const suggestion = {
  severity: "suggestion",
  title: "Name the retry budget",
  body: "The 3 is a magic number.",
  path: "lib/retry.ts",
};

/** The #535 shape: rejected issue reports, then a clean one with nothing listed. */
const droppedFindings = review(
  rejected({ hasIssues: true, summary: CLAIM }),
  rejected({ hasIssues: true, summary: CLAIM }),
  accepted({ hasIssues: false, summary: CLAIM })
);

describe("readReviewReportState", () => {
  it("should treat a clean report after a rejected issue report as dropped findings", () => {
    expect(readReviewReportState(droppedFindings.steps).kind).toBe(
      "dropped_findings"
    );
  });

  it("should treat a clean report that clears earlier listed findings as dropped findings", () => {
    const cleared = review(
      accepted({ hasIssues: true, summary: CLAIM, findings: [suggestion] }),
      accepted({ hasIssues: false, summary: "Fine." })
    );

    expect(readReviewReportState(cleared.steps).kind).toBe("dropped_findings");
  });

  it("should treat a review whose every report was rejected as missing", () => {
    const allRejected = review(
      rejected({ hasIssues: true, summary: CLAIM }),
      rejected({ hasIssues: true, summary: CLAIM })
    );

    expect(readReviewReportState(allRejected.steps).kind).toBe("missing");
  });

  it("should use the accepted report, not a rejected one after it", () => {
    const state = readReviewReportState(
      review(
        accepted({ hasIssues: true, summary: CLAIM, findings: [suggestion] }),
        rejected({ hasIssues: true, summary: "Retry." })
      ).steps
    );

    expect(state.kind).toBe("filed");
    expect(state.kind === "filed" && state.report.summary).toBe(CLAIM);
  });

  it("should accept a clean report that lists its suggestions after a rejected claim", () => {
    const listed = review(
      rejected({ hasIssues: true, summary: CLAIM }),
      accepted({ hasIssues: false, summary: CLAIM, findings: [suggestion] })
    );

    expect(readReviewReportState(listed.steps).kind).toBe("filed");
  });

  it("should accept a clean report nothing contradicted", () => {
    const clean = review(accepted({ hasIssues: false, summary: "Fine." }));

    expect(readReviewReportState(clean.steps).kind).toBe("filed");
  });
});

describe("what a review that dropped its findings publishes", () => {
  const harnessResult = extractPrReviewHarnessResult(droppedFindings);

  it("should have no verdict", () => {
    expect(harnessResult.source).toBe("dropped_findings");
    expect(isPrReviewVerdictMissing(harnessResult)).toBe(true);
  });

  it("should say the review is incomplete and why, never that no issues were found", () => {
    const body = buildPrReviewTimelineCommentBody({
      harnessResult,
      fallbackText: droppedFindings.text,
      conclusion: "neutral",
    });

    expect(
      buildPrReviewStatusHeading({ harnessResult, conclusion: "neutral" })
    ).toBe("**Status:** Review incomplete");
    expect(
      buildPrReviewCheckTitle({ harnessResult, conclusion: "neutral" })
    ).toBe("Review incomplete");
    expect(body).toContain(buildPrReviewContractNote("dropped_findings"));
    expect(body).not.toContain("No material issues found");
  });

  it("should block an auto-merge", () => {
    expect(
      getPrReviewAutoMergeBlockReason({
        reviewOutcome: harnessResult.reviewOutcome,
        verdictMissing: isPrReviewVerdictMissing(harnessResult),
        requestedPrNumber: 42,
        reviewedPrNumber: 42,
      })
    ).toBe("Mogplex review finished without a structured verdict");
  });
});
