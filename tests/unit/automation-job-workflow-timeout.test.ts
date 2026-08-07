import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS,
  AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
  getAutomationGenerateTimeoutMs,
} from "../../lib/workflows/automation-model-execution";
import {
  loadAutomationJobWorkflowModule,
  restoreEnv,
} from "./helpers/automation-job-fixtures";

test("automation model generate timeout preserves the full retry budget", () => {
  assert.equal(
    getAutomationGenerateTimeoutMs(null),
    AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS
  );
  assert.equal(
    getAutomationGenerateTimeoutMs(30_000),
    AUTOMATION_MODEL_TIMEOUT_FLOOR_MS * 2
  );
  assert.equal(getAutomationGenerateTimeoutMs(360_000), 720_000);
  assert.equal(
    getAutomationGenerateTimeoutMs(30 * 60_000),
    AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS
  );
});

test("resolveAutomationAiCallModel records one effective Gateway fallback model", async () => {
  const { resolveAutomationAiCallModel } =
    await loadAutomationJobWorkflowModule();

  assert.equal(
    resolveAutomationAiCallModel("xai/grok-4.5", {
      effectiveModelIds: ["zai/glm-5.2-fast"],
    }),
    "zai/glm-5.2-fast"
  );
  assert.equal(
    resolveAutomationAiCallModel("xai/grok-4.5", {
      effectiveModelIds: ["xai/grok-4.5", "zai/glm-5.2-fast"],
    }),
    "xai/grok-4.5"
  );
  assert.equal(
    resolveAutomationAiCallModel("xai/grok-4.5", null),
    "xai/grok-4.5"
  );
});

test("buildAutofixSandboxInternalApiHeaders carries workflow team scope", async () => {
  const { buildAutofixSandboxInternalApiHeaders } =
    await loadAutomationJobWorkflowModule();
  const originalSecret = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = "internal-secret";
  try {
    assert.deepEqual(
      buildAutofixSandboxInternalApiHeaders({
        metadata: { team_id: " 00000000-0000-4000-8000-000000000123 " },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      }),
      {
        "Content-Type": "application/json",
        Authorization: "Bearer internal-secret",
        "X-Delegated-User-Id": "user-123",
        "x-mogplex-team-id": "00000000-0000-4000-8000-000000000123",
      }
    );
  } finally {
    restoreEnv("INTERNAL_API_SECRET", originalSecret);
  }
});
