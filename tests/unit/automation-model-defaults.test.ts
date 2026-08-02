import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_MODEL_DEFAULT_FALLBACK_POOL,
  AUTOMATION_MODEL_FALLBACK_POOL_MAX_SIZE,
  getAutomationModelFallbackIds,
  resolveAutomationModelFallbackPool,
} from "../../lib/workflows/automation-model-defaults";

test("automation model fallbacks use the bounded safe defaults when unconfigured", () => {
  assert.deepEqual(resolveAutomationModelFallbackPool(undefined), [
    ...AUTOMATION_MODEL_DEFAULT_FALLBACK_POOL,
  ]);
  assert.deepEqual(resolveAutomationModelFallbackPool("  "), [
    ...AUTOMATION_MODEL_DEFAULT_FALLBACK_POOL,
  ]);
});

test("automation model fallback configuration normalizes, validates, and deduplicates entries", () => {
  assert.deepEqual(
    resolveAutomationModelFallbackPool(
      " OpenAI/GPT-5.4 , invalid, ZAI/GLM-5.2-FAST, openai/gpt-5.4, https://example.com/model, provider/model/extra, google/gemini-3-flash "
    ),
    ["openai/gpt-5.4", "zai/glm-5.2-fast", "google/gemini-3-flash"]
  );
});

test("automation model fallback configuration keeps a bounded candidate pool", () => {
  const configuredModels = Array.from(
    { length: AUTOMATION_MODEL_FALLBACK_POOL_MAX_SIZE + 3 },
    (_, index) => `provider/model-${index}`
  ).join(",");

  assert.deepEqual(
    resolveAutomationModelFallbackPool(configuredModels),
    Array.from(
      { length: AUTOMATION_MODEL_FALLBACK_POOL_MAX_SIZE },
      (_, index) => `provider/model-${index}`
    )
  );
});

test("automation model fallbacks reject invalid-only overrides and exclude the primary", () => {
  assert.deepEqual(
    getAutomationModelFallbackIds(
      " OPENAI/GPT-5.4 ",
      "not-a-model, http://github.com/model, provider/"
    ),
    ["zai/glm-5.2-fast"]
  );
  assert.deepEqual(
    getAutomationModelFallbackIds(
      "openai/gpt-5.4",
      "OpenAI/GPT-5.4, GOOGLE/GEMINI-3-FLASH"
    ),
    ["google/gemini-3-flash"]
  );
  assert.deepEqual(
    getAutomationModelFallbackIds(
      "google/gemini-3-flash",
      "GOOGLE/GEMINI-3-FLASH"
    ),
    ["zai/glm-5.2-fast", "openai/gpt-5.4"]
  );
});
