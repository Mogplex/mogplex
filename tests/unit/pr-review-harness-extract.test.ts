import assert from "node:assert/strict";
import test from "node:test";
import { extractPrReviewHarnessResult } from "../../lib/workflows/pr-review-harness";
import { makeStep } from "./helpers/pr-review-harness-fixtures";

test("extractPrReviewHarnessResult prefers structured reportReview output", () => {
  const result = extractPrReviewHarnessResult({
    text: "Reviewer found one issue.",
    steps: [
      makeStep({
        toolCalls: [
          {
            toolName: "postComment",
            input: { body: "Legacy comment body" },
          },
          {
            toolName: "reportReview",
            input: {
              hasIssues: true,
              summary: "Structured summary",
              commentBody: "Structured comment body",
              affectedFiles: ["src/widget.ts"],
              findings: [
                {
                  severity: "warning",
                  title: "Guard nullable lookup",
                  body: "The lookup can return undefined.",
                  path: "src/widget.ts",
                  line: 12,
                },
              ],
            },
          },
        ],
      }),
    ],
  });

  assert.deepEqual(result, {
    source: "structured",
    fallbackText: "Reviewer found one issue.",
    reviewOutcome: {
      hasIssues: true,
      summary: "Structured summary",
      commentBody: "Structured comment body",
      affectedFiles: ["src/widget.ts"],
      findings: [
        {
          severity: "warning",
          title: "Guard nullable lookup",
          body: "The lookup can return undefined.",
          path: "src/widget.ts",
          line: 12,
        },
      ],
    },
  });
});

test("extractPrReviewHarnessResult surfaces applied autofix commit details", () => {
  const result = extractPrReviewHarnessResult({
    text: "Reviewer found one issue.\n\nApplied a fix.",
    steps: [
      makeStep({
        toolCalls: [
          {
            toolName: "reportReview",
            input: {
              hasIssues: true,
              summary: "Reviewer found one issue.",
              commentBody: "Guard the nullable widget lookup.",
              affectedFiles: ["src/widget.ts"],
              findings: [],
            },
          },
        ],
      }),
      makeStep({
        toolCalls: [
          {
            toolName: "updateFile",
            input: {
              path: "src/widget.ts",
              message: "Fix nullable widget lookup",
            },
          },
          {
            toolName: "reportFix",
            input: {
              applied: true,
              summary: "Added the missing nullable guard.",
              updatedFiles: ["src/widget.ts"],
            },
          },
        ],
        toolResults: [
          {
            success: true,
            branch: "fix/widget-guard",
            path: "src/widget.ts",
            commitSha: "abcdef1234567890",
            commitUrl: "https://github.com/acme/widgets/commit/abcdef1",
          },
          {
            applied: true,
            summary: "Added the missing nullable guard.",
          },
        ],
      }),
    ],
  });

  assert.deepEqual(result.autofix, {
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
  });
});

test("extractPrReviewHarnessResult aggregates autofix across multiple reportFix steps", () => {
  const result = extractPrReviewHarnessResult({
    text: "Reviewer found two issues.\n\nOne fix applied.",
    steps: [
      makeStep({
        toolCalls: [
          {
            toolName: "reportReview",
            input: {
              hasIssues: true,
              summary: "Reviewer found two issues.",
              commentBody: "Fix the widget and docs paths.",
              affectedFiles: ["src/widget.ts", "docs/widget.md"],
              findings: [],
            },
          },
        ],
      }),
      makeStep({
        toolCalls: [
          {
            toolName: "updateFile",
            input: {
              path: "src/widget.ts",
              message: "Fix nullable widget lookup",
            },
          },
          {
            toolName: "reportFix",
            input: {
              applied: true,
              summary: "Added the missing nullable guard.",
              updatedFiles: ["src/widget.ts"],
            },
          },
        ],
        toolResults: [
          {
            success: true,
            branch: "fix/widget-guard",
            path: "src/widget.ts",
            commitSha: "abcdef1234567890",
            commitUrl: "https://github.com/acme/widgets/commit/abcdef1",
          },
          {
            applied: true,
            summary: "Added the missing nullable guard.",
          },
        ],
      }),
      makeStep({
        toolCalls: [
          {
            toolName: "reportFix",
            input: {
              applied: false,
              summary: "No safe documentation fix was available.",
              updatedFiles: ["docs/widget.md"],
            },
          },
        ],
        toolResults: [
          {
            applied: false,
            summary: "No safe documentation fix was available.",
          },
        ],
      }),
    ],
  });

  assert.deepEqual(result.autofix, {
    applied: true,
    summary:
      "Added the missing nullable guard.\n\nNo safe documentation fix was available.",
    updatedFiles: ["src/widget.ts", "docs/widget.md"],
    commits: [
      {
        path: "src/widget.ts",
        branch: "fix/widget-guard",
        commitSha: "abcdef1234567890",
        commitUrl: "https://github.com/acme/widgets/commit/abcdef1",
      },
    ],
  });
});

test("extractPrReviewHarnessResult falls back to the legacy review comment when reportReview is missing", () => {
  const result = extractPrReviewHarnessResult({
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

  assert.deepEqual(result, {
    source: "legacy_post_comment",
    fallbackText: "Guard the nullable widget lookup.",
    reviewOutcome: {
      hasIssues: true,
      summary: "Reviewer found one issue.",
      commentBody: "Guard the nullable widget lookup.",
      affectedFiles: [],
      findings: [],
    },
  });
});
