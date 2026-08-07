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

test("buildPrReviewInlineComments demotes headings in finding bodies", () => {
  const comments = buildPrReviewInlineComments([
    {
      severity: "warning",
      title: "Guard nullable lookup",
      body: "## Why it matters\nThe lookup can return undefined.",
      path: "src/widget.ts",
      line: 12,
    },
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

test("buildPrReviewGithubReviewBody omits inline findings from the body while counting them", () => {
  const body = buildPrReviewGithubReviewBody({
    reviewOutcome: {
      hasIssues: true,
      summary: "Reviewer found two issues.",
      commentBody: "Two issues need fixes.",
      affectedFiles: ["src/widget.ts"],
      findings: [
        {
          severity: "warning",
          title: "Guard nullable lookup",
          body: "The lookup can return undefined.",
          path: "src/widget.ts",
          line: 12,
        },
        {
          severity: "suggestion",
          title: "Document retry behaviour",
          body: "Explain why the fallback path is safe.",
          path: null,
          line: null,
        },
      ],
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
      "Reviewer found two issues.",
      "",
      "1 finding was added inline.",
      "",
      "Suggestions",
      "- Document retry behaviour",
      "  Explain why the fallback path is safe.",
      "",
      "[View check run](https://github.com/acme/widgets/runs/88)",
    ].join("\n")
  );
});

test("buildPrReviewGithubReviewBody includes applied autofix commit diff links", () => {
  const body = buildPrReviewGithubReviewBody({
    reviewOutcome: {
      hasIssues: true,
      summary: "Reviewer found one issue.",
      commentBody: "Guard the nullable widget lookup.",
      affectedFiles: ["src/widget.ts"],
      findings: [],
    },
    conclusion: "neutral",
    checkRunUrl: "https://github.com/acme/widgets/runs/89",
    inlineCommentCount: 0,
    autofix: {
      applied: true,
      summary: "Added the missing nullable guard.",
      updatedFiles: ["src/widget.ts"],
      commits: [
        {
          path: "src/widget.ts",
          branch: "fix/widget-guard",
          commitSha: "abcdef1234567890",
          commitUrl: "https://github.com/acme/widgets/commit/abcdef1",
        },
      ],
    },
  });

  assert.equal(
    body,
    [
      "## Mogplex PR Review",
      "",
      "**Status:** Attention needed",
      "",
      "Reviewer found one issue.",
      "",
      "Autofix Applied",
      "Added the missing nullable guard.",
      "Updated files:",
      "- `src/widget.ts`",
      "Commit diffs:",
      "- [abcdef1](https://github.com/acme/widgets/commit/abcdef1) `src/widget.ts`",
      "",
      "[View check run](https://github.com/acme/widgets/runs/89)",
    ].join("\n")
  );
});
