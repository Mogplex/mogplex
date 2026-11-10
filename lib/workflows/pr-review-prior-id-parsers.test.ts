import { describe, expect, it } from "vitest";
import { parseAutomationHarnessReviewResult } from "./automation-job-prompts";
import { extractFlowReviewOutcome } from "./automation-job-review-outcome";
import type { PrReviewHistory } from "./pr-review-history";
import { assignFindingKeys } from "./pr-review-lifecycle";

const reReported = {
  severity: "warning",
  // A revised title: only the id links it to the earlier finding.
  title: "Unchecked null, now on the retry path too",
  body: "Answering the reply: the guard misses retries.",
  path: "lib/a.ts",
  line: 5,
  priorId: "F1",
};

const history: PrReviewHistory = {
  reviewedSha: "old",
  reviewedAt: "2026-11-09T10:00:00.000Z",
  mode: "full",
  changedFiles: [],
  threadsLoaded: true,
  conversation: [],
  findings: [
    {
      id: "F1",
      key: "aaaaaaaaaaaa",
      severity: "warning",
      title: "Unchecked null",
      path: "lib/a.ts",
      line: 4,
      inline: true,
      thread: null,
    },
  ],
};

describe("priorId on every review parser", () => {
  it("should keep the earlier key for a CLI harness result line", () => {
    const outcome = parseAutomationHarnessReviewResult(
      `Done.\nMOGPLEX_REVIEW_RESULT: ${JSON.stringify({
        hasIssues: true,
        summary: "One finding stands.",
        findings: [reReported],
      })}`
    );
    const findings = outcome?.findings ?? [];

    expect(findings[0]?.priorId).toBe("F1");
    expect([...assignFindingKeys(findings, history).values()]).toEqual([
      "aaaaaaaaaaaa",
    ]);
  });

  it("should keep the earlier key for a flow review node", () => {
    const outcome = extractFlowReviewOutcome([
      {
        fromNodeId: "review",
        label: "Review",
        text: "Reviewed.",
        skipped: false,
        payload: {
          role: "review",
          review: {
            hasIssues: true,
            summary: "One finding stands.",
            findings: [reReported],
          },
        },
      },
    ]);
    const findings = outcome?.findings ?? [];

    expect([...assignFindingKeys(findings, history).values()]).toEqual([
      "aaaaaaaaaaaa",
    ]);
  });
});
