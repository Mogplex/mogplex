import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrReviewCheckSummary,
  buildPrReviewCheckText,
  buildPrReviewGithubReviewBody,
  buildPrReviewInlineComments,
  buildPrReviewTimelineCommentBody,
  demoteAgentMarkdownHeadings,
  extractPrReviewHarnessResult,
} from "../../lib/workflows/pr-review-harness";

function makeStep(input: {
  toolCalls?: Array<{ toolName: string; input: unknown }>;
  toolResults?: unknown[];
}) {
  return {
    toolCalls: input.toolCalls ?? [],
    toolResults: input.toolResults ?? [],
  };
}

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

test("buildPrReviewCheckText prefers the summary over commentBody when structured findings exist", () => {
  const harnessResult = extractPrReviewHarnessResult({
    text: "Reviewer finished.",
    steps: [
      makeStep({
        toolCalls: [
          {
            toolName: "reportReview",
            input: {
              hasIssues: true,
              summary: "One warning worth a look.",
              commentBody: [
                "## Warnings",
                "### Guard nullable lookup",
                "The lookup can return undefined.",
              ].join("\n"),
              findings: [
                {
                  severity: "warning",
                  title: "Guard nullable lookup",
                  body: "The lookup can return undefined.",
                  path: "src/widget.ts",
                },
              ],
            },
          },
        ],
      }),
    ],
  });

  const text = buildPrReviewCheckText({
    harnessResult,
    fallbackText: null,
    conclusion: "neutral",
  });

  assert.match(text, /^One warning worth a look\./);
  assert.doesNotMatch(text, /\*\*Warnings\*\*/);
  assert.match(text, /Warnings\n- Guard nullable lookup \(src\/widget\.ts\)/);
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

test("buildPrReviewCheckText appends structured diagnostics for failed reviews", () => {
  const text = buildPrReviewCheckText({
    harnessResult: null,
    fallbackText:
      "AI provider timed out during PR review after 180s. Runtime: trigger: run_pr_review_28.",
    conclusion: "failure",
    failureDetails: {
      reasonLabel: "Automation infra failed",
      error:
        "AI provider timed out during PR review after 180s. Runtime: trigger: run_pr_review_28.",
      modelFailureClass: "timeout",
      modelFailureMessage:
        "Gateway request timed out: Cannot connect to API: Headers Timeout Error",
      modelFailureStatusCode: 408,
      modelEffectiveTimeoutMs: 180000,
      modelAttempts: 1,
      modelRetryAttempted: false,
      runtimeProvider: "trigger",
      runtimeRunId: "run_pr_review_28",
    },
  });

  assert.equal(
    text,
    [
      "AI provider timed out during PR review after 180s.",
      "",
      "Diagnostics",
      "- Failure type: Automation infra failed",
      "- Model failure: Timeout",
      "- HTTP status: 408",
      "- Timeout budget: 180s",
      "- Attempts: 1",
      "- Retry attempted: No",
      "- Provider detail: Gateway request timed out: Cannot connect to API: Headers Timeout Error",
    ].join("\n")
  );
  assert.doesNotMatch(text, /run_pr_review_28|Runtime:/);
});

test("buildPrReviewCheckSummary uses structured failure metadata when available", () => {
  assert.equal(
    buildPrReviewCheckSummary({
      harnessResult: null,
      fallbackText: "Automation model authentication failed",
      conclusion: "failure",
      failureDetails: {
        modelFailureClass: "authentication",
      },
    }),
    "Review failed: Authentication"
  );

  assert.equal(
    buildPrReviewCheckSummary({
      harnessResult: null,
      fallbackText:
        "Automation model request timed out: Gateway request timed out",
      conclusion: "failure",
      failureDetails: {
        reasonLabel: "Automation infra failed",
        modelFailureClass: "timeout",
        modelFailureStatusCode: 408,
      },
    }),
    "Automation infra failed: Timeout (HTTP 408)"
  );

  assert.equal(
    buildPrReviewCheckSummary({
      harnessResult: null,
      fallbackText:
        "Supabase was unavailable while recording PR review workflow state.",
      conclusion: "failure",
      failureDetails: {
        reasonLabel: "Automation infra failed",
        infraFailureClass: "supabase_unavailable",
        modelFailureClass: "timeout",
        modelFailureStatusCode: 408,
      },
    }),
    "Automation infra failed: Supabase unavailable (HTTP 408)"
  );
});

test("buildPrReviewCheckText preserves HTML-like fallback text on non-failures", () => {
  const fallbackText = "Mention the <html> and <body> tags in the docs review.";

  assert.equal(
    buildPrReviewCheckText({
      harnessResult: null,
      fallbackText,
      conclusion: "neutral",
    }),
    fallbackText
  );

  assert.equal(
    buildPrReviewCheckSummary({
      harnessResult: null,
      fallbackText,
      conclusion: "success",
    }),
    fallbackText
  );
});

test("buildPrReviewCheckText sanitizes HTML-like fallback text on failures", () => {
  const fallbackText = "Mention the <html> and <body> tags in the docs review.";

  assert.equal(
    buildPrReviewCheckText({
      harnessResult: null,
      fallbackText,
      conclusion: "failure",
    }),
    "Automation infrastructure returned an HTML error page."
  );

  assert.equal(
    buildPrReviewCheckSummary({
      harnessResult: null,
      fallbackText,
      conclusion: "failure",
    }),
    "Automation infrastructure returned an HTML error page."
  );
});

test("PR review failure rendering sanitizes Supabase HTML outage pages", () => {
  const htmlFailure = [
    "<title>testprojectref000000.supabase.co | 522: Connection timed out</title>",
    "Connection timed out Error code 522",
    "Cloudflare Ray ID: 9f09ee74a6bba3be",
  ].join("\n");

  assert.equal(
    buildPrReviewCheckSummary({
      harnessResult: null,
      fallbackText: htmlFailure,
      conclusion: "failure",
      failureDetails: {
        reasonLabel: "Automation infra failed",
        error: htmlFailure,
        infraFailureClass: "supabase_unavailable",
        infraFailureMessage:
          "Cloudflare 522 while reaching the Supabase origin",
      },
    }),
    "Automation infra failed: Supabase unavailable"
  );

  assert.equal(
    buildPrReviewCheckText({
      harnessResult: null,
      fallbackText: htmlFailure,
      conclusion: "failure",
      failureDetails: {
        reasonLabel: "Automation infra failed",
        error: htmlFailure,
        infraFailureClass: "supabase_unavailable",
        infraFailureMessage:
          "Cloudflare 522 while reaching the Supabase origin",
      },
    }),
    [
      "Supabase was unavailable while recording workflow state.",
      "",
      "Diagnostics",
      "- Failure type: Automation infra failed",
      "- Infra failure: Supabase unavailable",
      "- Infra detail: Cloudflare 522 while reaching the Supabase origin",
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
