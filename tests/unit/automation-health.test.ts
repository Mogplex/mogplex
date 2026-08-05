import assert from "node:assert/strict";
import test from "node:test";
import { getAutomationHealthStatus } from "../../lib/observability/automation-health";

test("no current run issue is healthy", () => {
  assert.equal(
    getAutomationHealthStatus({
      failedInRange: 0,
      stalePending: 0,
      runSuccessRate: 100,
    }),
    "healthy"
  );
});

test("current failed or stale runs require attention", () => {
  assert.equal(
    getAutomationHealthStatus({
      failedInRange: 1,
      stalePending: 0,
      runSuccessRate: 99,
    }),
    "needs_attention"
  );
  assert.equal(
    getAutomationHealthStatus({
      failedInRange: 0,
      stalePending: 1,
      runSuccessRate: 100,
    }),
    "needs_attention"
  );
});

test("a failed success-rate tone requires review without a current run row", () => {
  assert.equal(
    getAutomationHealthStatus({
      failedInRange: 0,
      stalePending: 0,
      runSuccessRate: 79.9,
    }),
    "needs_attention"
  );
});

test("no concluded runs use the no-activity state", () => {
  assert.equal(
    getAutomationHealthStatus({
      failedInRange: 0,
      stalePending: 0,
      runSuccessRate: null,
    }),
    "no_activity"
  );
});
