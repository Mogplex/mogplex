import assert from "node:assert/strict";
import test from "node:test";
import { AI_CALL_TYPES, isAiCallType } from "../../lib/ai-call-types";

test("ai call types include all durable workflow automation events", () => {
  assert.ok(AI_CALL_TYPES.includes("cron"));
  assert.ok(AI_CALL_TYPES.includes("mention"));
  assert.ok(AI_CALL_TYPES.includes("pr_comment"));
  assert.ok(AI_CALL_TYPES.includes("issue_comment"));
});

test("isAiCallType recognizes supported workflow observability values", () => {
  assert.equal(isAiCallType("ci_failure"), true);
  assert.equal(isAiCallType("issue_comment"), true);
  assert.equal(isAiCallType("not-real"), false);
});
