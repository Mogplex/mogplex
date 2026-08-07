import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS,
  AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS,
  AUTOMATION_MODEL_MAX_GENERATE_RETRIES,
  AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
  getEffectiveAutomationTimeoutMs,
} from "../../lib/workflows/automation-model-execution";
import { getAutomationModelFallbackIds } from "../../lib/workflows/automation-model-defaults";

test("getEffectiveAutomationTimeoutMs applies the automation default and floor", () => {
  assert.ok(
    AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS *
      (AUTOMATION_MODEL_MAX_GENERATE_RETRIES + 1) <=
      AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS
  );
  assert.ok(
    AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS >= AUTOMATION_MODEL_TIMEOUT_FLOOR_MS
  );
  assert.equal(
    getEffectiveAutomationTimeoutMs(null),
    AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS
  );
  assert.equal(
    getEffectiveAutomationTimeoutMs(18_000),
    AUTOMATION_MODEL_TIMEOUT_FLOOR_MS
  );
  assert.equal(getEffectiveAutomationTimeoutMs(360_000), 360_000);
});

test("getAutomationModelFallbackIds orders candidates distinct from the primary", () => {
  assert.deepEqual(getAutomationModelFallbackIds("xai/grok-4.5"), [
    "zai/glm-5.2-fast",
    "openai/gpt-5.4",
  ]);
  assert.deepEqual(getAutomationModelFallbackIds(" ZAI/GLM-5.2-FAST "), [
    "openai/gpt-5.4",
  ]);
  assert.deepEqual(getAutomationModelFallbackIds("openai/gpt-5.4"), [
    "zai/glm-5.2-fast",
  ]);
});
