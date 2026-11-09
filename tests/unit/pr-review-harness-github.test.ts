import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrReviewGithubReviewBody,
  buildPrReviewInlineComments,
  demoteAgentMarkdownHeadings,
} from "../../lib/workflows/pr-review-harness";

test("demoteAgentMarkdownHeadings converts ATX headings to bold outside code fences", () => {
  const input = [
    "## Summary",
    "All good.",
    "```md",
    "## kept inside fence",
    "```",
    "### [TESTING] tests/unit/foo.test.ts:L12 ###",
    "#not-a-heading",
  ].join("\n");

  assert.equal(
    demoteAgentMarkdownHeadings(input),
    [
      "**Summary**",
      "All good.",
      "```md",
      "## kept inside fence",
      "```",
      "**[TESTING] tests/unit/foo.test.ts:L12**",
      "#not-a-heading",
    ].join("\n")
  );
});

const warning = {
  severity: "warning" as const,
  title: "Guard nullable lookup",
  body: "## Why it matters\nThe lookup can return undefined.",
  path: "src/widget.ts",
  line: 12,
};

test("buildPrReviewInlineComments demotes headings in finding bodies", () => {
  const comments = buildPrReviewInlineComments([
    { path: "src/widget.ts", line: 12, finding: warning, anchor: "exact" },
  ]);

  assert.equal(comments.length, 1);
  assert.equal(
    comments[0].body,
    [
      "**Warning:** Guard nullable lookup",
      "",
      "**Why it matters**\nThe lookup can return undefined.",
    ].join("\n")
  );
});

test("buildPrReviewInlineComments says where a re-anchored finding points", () => {
  const comments = buildPrReviewInlineComments([
    {
      path: "src/widget.ts",
      line: 14,
      finding: { ...warning, line: 40 },
      anchor: "nearest",
    },
    {
      path: "src/widget.ts",
      line: 3,
      finding: { ...warning, line: null },
      anchor: "file",
    },
  ]);

  assert.match(
    comments[0].body,
    /About line 40, which this diff does not show/
  );
  assert.equal(comments[0].line, 14);
  assert.match(comments[1].body, /About this file as a whole/);
});

test("buildPrReviewGithubReviewBody points at the summary comment instead of repeating findings", () => {
  const body = buildPrReviewGithubReviewBody({
    harnessResult: {
      source: "structured",
      fallbackText: null,
      reviewOutcome: {
        hasIssues: true,
        summary: "Reviewer found two issues.",
        commentBody: null,
        affectedFiles: ["src/widget.ts"],
        findings: [{ ...warning, body: "The lookup can return undefined." }],
      },
    },
    conclusion: "neutral",
    checkRunUrl: "https://github.com/acme/widgets/runs/88",
    inlineCommentCount: 1,
  });

  assert.equal(
    body,
    [
      "## Mogplex PR Review",
      "",
      "**Status:** Attention needed",
      "",
      "1 finding is on the changed lines below. The full review is in the Mogplex PR Review comment on this pull request.",
      "",
      "[View check run](https://github.com/acme/widgets/runs/88)",
    ].join("\n")
  );
});
