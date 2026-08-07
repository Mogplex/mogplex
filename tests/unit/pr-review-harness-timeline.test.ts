import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrReviewTimelineCommentBody,
  extractPrReviewHarnessResult,
} from "../../lib/workflows/pr-review-harness";
import { makeStep } from "./helpers/pr-review-harness-fixtures";

test("buildPrReviewTimelineCommentBody notes when fallback output is used", () => {
  const harnessResult = extractPrReviewHarnessResult({
    text: "Reviewer found one issue.",
    steps: [
      makeStep({
        toolCalls: [
          {
            toolName: "postComment",
            input: { body: "Guard the nullable widget lookup." },
          },
        ],
      }),
    ],
  });

  assert.equal(
    buildPrReviewTimelineCommentBody({
      harnessResult,
      fallbackText: "Reviewer found one issue.",
      conclusion: "neutral",
      checkRunUrl: "https://github.com/acme/widgets/runs/77",
    }),
    [
      "## Mogplex PR Review",
      "",
      "**Status:** Attention needed",
      "",
      "Note: Structured review output was missing, so Mogplex used the legacy review comment as fallback output.",
      "",
      "Guard the nullable widget lookup.",
      "",
      "[View check run](https://github.com/acme/widgets/runs/77)",
    ].join("\n")
  );
});

test("buildPrReviewTimelineCommentBody demotes agent headings in commentBody", () => {
  const harnessResult = extractPrReviewHarnessResult({
    text: "Reviewer finished.",
    steps: [
      makeStep({
        toolCalls: [
          {
            toolName: "reportReview",
            input: {
              hasIssues: false,
              summary: "Approve-ready.",
              commentBody: [
                "## Summary",
                "Approve-ready.",
                "## Verdict",
                "APPROVE",
              ].join("\n\n"),
            },
          },
        ],
      }),
    ],
  });

  const body = buildPrReviewTimelineCommentBody({
    harnessResult,
    fallbackText: null,
    conclusion: "success",
  });

  assert.match(body, /^## Mogplex PR Review/);
  assert.match(body, /\*\*Summary\*\*/);
  assert.match(body, /\*\*Verdict\*\*/);
  assert.doesNotMatch(body, /\n## Summary/);
  assert.doesNotMatch(body, /\n## Verdict/);
});
