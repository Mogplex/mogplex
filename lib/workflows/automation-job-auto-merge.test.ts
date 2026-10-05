import { describe, expect, it } from "vitest";
import { getPrReviewAutoMergeBlockReason } from "./automation-job-auto-merge";

describe("review verdict merge guards", () => {
  const reviewed = { requestedPrNumber: 42, reviewedPrNumber: 42 };
  it("rejects a clean report for another pull request", () => {
    expect(
      getPrReviewAutoMergeBlockReason({
        ...reviewed,
        requestedPrNumber: 43,
        reviewOutcome: { hasIssues: false },
      })
    ).toBe("Safe merge target does not match the reviewed pull request");
  });
  it("rejects findings and unavailable verdicts instead of allowing a merge", () => {
    expect(
      getPrReviewAutoMergeBlockReason({
        ...reviewed,
        reviewOutcome: { hasIssues: true },
      })
    ).toBe("Mogplex review reported issues");
    expect(
      getPrReviewAutoMergeBlockReason({ ...reviewed, reviewOutcome: null })
    ).toBe("Mogplex review did not produce a no-issues verdict");
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
        ...reviewed,
        reviewOutcome: { hasIssues: false },
      })
    ).toBeNull();
  });
});
