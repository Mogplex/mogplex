import { describe, expect, it } from "vitest";

import {
  PR_REVIEW_REASON_CODES,
  formatAutomationReasonLabel,
  getReviewOutcomeSummary,
} from "./automation-review";

describe("superseded PR review reason", () => {
  it("formats a human-readable label", () => {
    expect(formatAutomationReasonLabel(PR_REVIEW_REASON_CODES.superseded)).toBe(
      "Superseded — PR closed or branch deleted"
    );
  });

  it("surfaces in the review outcome summary for PR review events", () => {
    expect(
      getReviewOutcomeSummary({
        outcome: "cancelled",
        reason: PR_REVIEW_REASON_CODES.superseded,
        metadata: null,
        source_type: "pr_opened",
      })
    ).toBe("Superseded — PR closed or branch deleted");
  });
});
