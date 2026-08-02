import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATION_REASON_CODES,
  PR_REVIEW_REASON_CODES,
  buildPrReviewHeadShaDedupKey,
  classifyAutomationFailureReason,
  formatAutomationReasonLabel,
  getReviewOutcomeSummary,
  normalizeAutomationReason,
} from "../../lib/automation-review";

test("buildPrReviewHeadShaDedupKey derives a stable idempotency key for PR head SHAs", () => {
  const key = buildPrReviewHeadShaDedupKey({
    sourceKind: "assignment",
    sourceType: "pr_review",
    sourceId: "assignment-1",
    repoId: "repo-1",
    installationId: 101,
    metadata: {
      pr_number: 42,
      head_sha: "abc123",
    },
  });

  assert.equal(
    key,
    "github-pr-review:assignment:assignment-1:pr_review:repo-1:101:42:abc123"
  );
});

test("normalizeAutomationReason remaps idempotent PR review duplicates to a readable reason", () => {
  const reason = normalizeAutomationReason("IDEMPOTENT_DUPLICATE", {
    review_dedup_key:
      "github-pr-review:assignment:assignment-1:pr_review:repo-1:101:42:abc123",
  });

  assert.equal(reason, PR_REVIEW_REASON_CODES.duplicateHeadSha);
  assert.equal(
    formatAutomationReasonLabel("IDEMPOTENT_DUPLICATE", {
      review_dedup_key:
        "github-pr-review:assignment:assignment-1:pr_review:repo-1:101:42:abc123",
    }),
    "Duplicate PR head SHA"
  );
});

test("getReviewOutcomeSummary surfaces explicit review lifecycle labels", () => {
  assert.equal(
    getReviewOutcomeSummary({
      source_type: "pr_review",
      outcome: "completed",
      reason: PR_REVIEW_REASON_CODES.noFindings,
      metadata: null,
    }),
    "No findings"
  );

  assert.equal(
    getReviewOutcomeSummary({
      source_type: "pr_opened",
      outcome: "failed",
      reason: PR_REVIEW_REASON_CODES.commentPostFailed,
      metadata: null,
    }),
    "Comment post failed"
  );

  assert.equal(
    getReviewOutcomeSummary({
      source_type: "pr_review",
      outcome: "failed",
      reason: PR_REVIEW_REASON_CODES.timelineCommentFailed,
      metadata: null,
    }),
    "Timeline comment failed"
  );

  assert.equal(
    getReviewOutcomeSummary({
      source_type: "pr_review",
      outcome: "completed",
      reason: PR_REVIEW_REASON_CODES.staleHeadSha,
      metadata: null,
    }),
    "Stale PR head SHA"
  );
});

test("classifyAutomationFailureReason maps model failure classes to generic automation reason codes", () => {
  assert.equal(
    classifyAutomationFailureReason({
      message: "Automation model request timed out",
      execution: { finalFailureClass: "timeout" },
    }),
    AUTOMATION_REASON_CODES.timeout
  );
  assert.equal(
    classifyAutomationFailureReason({
      message: "Automation model authentication failed",
      execution: { finalFailureClass: "authentication" },
    }),
    AUTOMATION_REASON_CODES.authenticationFailed
  );
  assert.equal(
    classifyAutomationFailureReason({
      message: "Unknown error",
      execution: null,
    }),
    AUTOMATION_REASON_CODES.failed
  );
  assert.equal(
    classifyAutomationFailureReason({
      message: "NO_GITHUB_CONNECTION",
      execution: null,
    }),
    "NO_GITHUB_CONNECTION"
  );
  assert.equal(
    formatAutomationReasonLabel(AUTOMATION_REASON_CODES.configurationFailed),
    "Configuration failed"
  );
});
