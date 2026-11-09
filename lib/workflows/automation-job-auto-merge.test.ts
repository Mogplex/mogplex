import { describe, expect, it } from "vitest";
import { getPrReviewAutoMergeBlockReason } from "./automation-job-auto-merge";

describe("review verdict merge guards", () => {
  const reviewed = { requestedPrNumber: 42, reviewedPrNumber: 42 };
  it("rejects a clean report for another pull request", () => {
    expect(
      getPrReviewAutoMergeBlockReason({
        verdictMissing: false,
        ...reviewed,
        requestedPrNumber: 43,
        reviewOutcome: { hasIssues: false },
      })
    ).toBe("Safe merge target does not match the reviewed pull request");
  });
  it("rejects findings and unavailable verdicts instead of allowing a merge", () => {
    expect(
      getPrReviewAutoMergeBlockReason({
        verdictMissing: false,
        ...reviewed,
        reviewOutcome: { hasIssues: true },
      })
    ).toBe("Mogplex review reported issues");
    expect(
      getPrReviewAutoMergeBlockReason({
        verdictMissing: false,
        ...reviewed,
        reviewOutcome: null,
      })
    ).toBe("Mogplex review did not produce a no-issues verdict");
  });
  it("follows the verdict: warnings block, suggestions alone merge", () => {
    const finding = {
      title: "Unchecked null",
      body: "Body.",
      path: "lib/a.ts",
      line: 4,
    };
    expect(
      getPrReviewAutoMergeBlockReason({
        verdictMissing: false,
        ...reviewed,
        reviewOutcome: {
          hasIssues: false,
          findings: [{ ...finding, severity: "warning" }],
        },
      })
    ).toBe("Mogplex review reported issues");
    expect(
      getPrReviewAutoMergeBlockReason({
        verdictMissing: false,
        ...reviewed,
        reviewOutcome: {
          hasIssues: false,
          findings: [{ ...finding, severity: "suggestion" }],
        },
      })
    ).toBeNull();
    expect(
      getPrReviewAutoMergeBlockReason({
        verdictMissing: false,
        ...reviewed,
        reviewOutcome: {
          hasIssues: true,
          findings: [{ ...finding, severity: "suggestion" }],
        },
      })
    ).toBeNull();
  });
  it("allows only a matching, filed clean report", () => {
    expect(
      getPrReviewAutoMergeBlockReason({
        ...reviewed,
        reviewOutcome: { hasIssues: false },
        verdictMissing: true,
      })
    ).toBe("Mogplex review finished without a structured verdict");
    expect(
      getPrReviewAutoMergeBlockReason({
        verdictMissing: false,
        ...reviewed,
        reviewOutcome: { hasIssues: false },
      })
    ).toBeNull();
  });
});
