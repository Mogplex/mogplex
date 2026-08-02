import assert from "node:assert/strict";
import test from "node:test";

async function loadAutomationRunPresentation() {
  return import("../../lib/observability/automation-run-presentation");
}

test("getAutomationStatusPresentation labels timed out failures from dispatch metadata", async () => {
  const { getAutomationStatusPresentation } =
    await loadAutomationRunPresentation();

  const presentation = getAutomationStatusPresentation({
    status: "failed",
    metadata: {
      model_failure_class: "timeout",
      model_effective_timeout_ms: 300_000,
    },
    error: "Automation model request timed out",
  });

  assert.deepEqual(presentation, {
    label: "Timed out",
    isTimedOut: true,
    failureClass: "timeout",
    timeoutBudgetMs: 300_000,
  });
});

test("getAutomationStatusPresentation falls back to nested automation_execution metadata for ai_calls", async () => {
  const { getAutomationStatusPresentation } =
    await loadAutomationRunPresentation();

  const presentation = getAutomationStatusPresentation({
    status: "failed",
    metadata: {
      automation_execution: {
        finalFailureClass: "timeout",
        effectiveTimeoutMs: 180_000,
      },
    },
    error: "Gateway request timed out",
  });

  assert.equal(presentation.label, "Timed out");
  assert.equal(presentation.isTimedOut, true);
  assert.equal(presentation.failureClass, "timeout");
  assert.equal(presentation.timeoutBudgetMs, 180_000);
});

test("getAutomationStatusPresentation detects timeout from the error string fallback path", async () => {
  const { getAutomationStatusPresentation } =
    await loadAutomationRunPresentation();

  const presentation = getAutomationStatusPresentation({
    status: "failed",
    metadata: null,
    error: "Gateway request timed out before provider response headers arrived",
  });

  assert.equal(presentation.label, "Timed out");
  assert.equal(presentation.isTimedOut, true);
  assert.equal(presentation.failureClass, null);
  assert.equal(presentation.timeoutBudgetMs, null);
});

test("getAutomationStatusPresentation never marks non-failed statuses as timed out", async () => {
  const { getAutomationStatusPresentation } =
    await loadAutomationRunPresentation();

  const presentation = getAutomationStatusPresentation({
    status: "success",
    metadata: {
      model_failure_class: "timeout",
      model_effective_timeout_ms: 300_000,
    },
    error: "Gateway request timed out",
  });

  assert.deepEqual(presentation, {
    label: "Success",
    isTimedOut: false,
    failureClass: "timeout",
    timeoutBudgetMs: null,
  });
});

test("getAutomationCostState distinguishes partial, missing, known, reconciled, and unknown cost states", async () => {
  const {
    getAutomationCostPrimaryLabel,
    getAutomationCostSecondaryLabel,
    getAutomationCostState,
  } = await loadAutomationRunPresentation();

  assert.equal(
    getAutomationCostState({ status: "failed", costUsd: 0.0184 }),
    "partial"
  );
  assert.equal(
    getAutomationCostState({ status: "failed", costUsd: null }),
    "unknown"
  );
  assert.equal(
    getAutomationCostState({ status: "success", costUsd: 0.0184 }),
    "known"
  );
  assert.equal(
    getAutomationCostState({
      status: "success",
      costUsd: 0.0184,
      costSource: "gateway",
    }),
    "reconciled"
  );
  assert.equal(
    getAutomationCostState({
      status: "streaming",
      costUsd: 0.0184,
      costSource: "gateway",
    }),
    "partial"
  );
  assert.equal(
    getAutomationCostState({ status: "success", costUsd: null }),
    "missing"
  );
  assert.equal(getAutomationCostSecondaryLabel("partial"), "partial");
  assert.equal(
    getAutomationCostSecondaryLabel("missing"),
    "success without cost"
  );
  assert.equal(getAutomationCostSecondaryLabel("unknown"), null);
  assert.equal(
    getAutomationCostPrimaryLabel({ costState: "partial", costUsd: 0.0184 }),
    "$0.018"
  );
  assert.equal(
    getAutomationCostPrimaryLabel({ costState: "unknown", costUsd: null }),
    "—"
  );
  assert.equal(
    getAutomationCostPrimaryLabel({ costState: "missing", costUsd: null }),
    "—"
  );
});

test("formatAutomationTimeoutBudgetLabel renders readable timeout budgets", async () => {
  const { formatAutomationTimeoutBudgetLabel } =
    await loadAutomationRunPresentation();

  assert.equal(formatAutomationTimeoutBudgetLabel(0), null);
  assert.equal(formatAutomationTimeoutBudgetLabel(999), "999ms budget");
  assert.equal(formatAutomationTimeoutBudgetLabel(30_000), "30s budget");
  assert.equal(formatAutomationTimeoutBudgetLabel(59_999), "59.9s budget");
  assert.equal(formatAutomationTimeoutBudgetLabel(60_000), "1m budget");
  assert.equal(formatAutomationTimeoutBudgetLabel(90_500), "1.5m budget");
  assert.equal(formatAutomationTimeoutBudgetLabel(300_000), "5m budget");
  assert.equal(formatAutomationTimeoutBudgetLabel(3_599_999), "59.9m budget");
  assert.equal(formatAutomationTimeoutBudgetLabel(3_600_000), "1h budget");
  assert.equal(formatAutomationTimeoutBudgetLabel(7_200_000), "2h budget");
  assert.equal(
    formatAutomationTimeoutBudgetLabel(Number.POSITIVE_INFINITY),
    null
  );
  assert.equal(formatAutomationTimeoutBudgetLabel(null), null);
});
