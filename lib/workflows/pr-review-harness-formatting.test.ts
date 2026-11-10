import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "@/lib/types";
import { buildPrReviewTimelineCommentBody } from "./pr-review-harness";
import { extractPrReviewHarnessResult } from "./pr-review-harness-extraction";
import { buildReviewFindingsSections } from "./pr-review-harness-formatting";

const finding = (title: string, body: string): ReviewFinding => ({
  severity: "warning",
  title,
  body,
  path: "src/a.ts",
  line: 3,
});

describe("buildReviewFindingsSections", () => {
  it("should keep this review's body under the link of a finding an earlier review threaded", () => {
    const carried = finding("Still open", "Answer: the retry path skips it.");
    const posted = finding("New one", "Posted inline this run.");

    const [warnings] = buildReviewFindingsSections([carried, posted], {
      links: new Map([
        [carried, "https://github.com/acme/widgets/pull/7#discussion_1"],
        [posted, "https://github.com/acme/widgets/pull/7#pullrequestreview-2"],
      ]),
      carried: new Set([carried]),
    });

    expect(warnings).toContain(
      "- **Still open** (`src/a.ts:L3`): [inline comment](https://github.com/acme/widgets/pull/7#discussion_1)\n  Answer: the retry path skips it."
    );
    expect(warnings).not.toContain("Posted inline this run.");
  });
});

describe("buildPrReviewTimelineCommentBody", () => {
  it("should cut a long review so the state marker still fits in a GitHub comment", () => {
    const harnessResult = extractPrReviewHarnessResult({
      text: "Done.",
      steps: [
        {
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: true,
                summary: "Many findings.",
                findings: Array.from({ length: 20 }, (_, index) =>
                  finding(`Finding ${index}`, "x".repeat(5000))
                ),
              },
            },
          ],
          toolResults: [{}],
        },
      ],
    });
    const stateMarker = `<!-- mogplex-review-state:${"a".repeat(16_000)}.sig -->`;

    const body = buildPrReviewTimelineCommentBody({
      harnessResult,
      fallbackText: null,
      conclusion: "neutral",
      stateMarker,
    });

    expect(body.length).toBeLessThan(65_536);
    expect(body.endsWith(stateMarker)).toBe(true);
    expect(body).toContain("The review was cut to fit in a GitHub comment.");
  });
});
