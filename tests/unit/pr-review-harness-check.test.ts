import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrReviewCheckSummary,
  buildPrReviewCheckText,
  extractPrReviewHarnessResult,
} from "../../lib/workflows/pr-review-harness";
import { makeStep } from "./helpers/pr-review-harness-fixtures";

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
