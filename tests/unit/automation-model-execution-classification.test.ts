import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAutomationModelError,
  AutomationModelExecutionError,
  asAutomationModelExecutionError,
  AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
} from "../../lib/workflows/automation-model-execution";
import {
  isModelAllowlistUnavailableError,
  MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
  MODEL_NOT_IN_ALLOWLIST_ERROR,
  modelAllowlistUnavailableError,
} from "../../lib/team-capabilities";

test("classifyAutomationModelError marks an unreadable team allowlist transient", () => {
  const classified = classifyAutomationModelError(
    modelAllowlistUnavailableError()
  );

  assert.equal(classified.classification, "dependency_unavailable");
  assert.equal(classified.retryable, true);
  assert.equal(
    classified.message,
    `Automation could not verify run policy: ${MODEL_ALLOWLIST_UNAVAILABLE_ERROR}`
  );
});

test("classifyAutomationModelError keys the allowlist class off the code, not the copy", () => {
  const rewordedCopy = Object.assign(new Error("Something else entirely."), {
    code: "MODEL_ALLOWLIST_UNAVAILABLE",
  });
  assert.equal(
    classifyAutomationModelError(rewordedCopy).classification,
    "dependency_unavailable"
  );

  const messageOnly = new Error(MODEL_ALLOWLIST_UNAVAILABLE_ERROR);
  assert.notEqual(
    classifyAutomationModelError(messageOnly).classification,
    "dependency_unavailable"
  );
});

test("classifyAutomationModelError prefers the allowlist code over message heuristics", () => {
  const noisy = Object.assign(
    new Error("connection reset while reading; request timed out"),
    { code: "MODEL_ALLOWLIST_UNAVAILABLE", statusCode: 503 }
  );

  assert.equal(
    classifyAutomationModelError(noisy).classification,
    "dependency_unavailable"
  );
});

test("classifyAutomationModelError sees the allowlist code through a wrapped cause", () => {
  const wrapped = new Error("Automation model resolution failed", {
    cause: modelAllowlistUnavailableError(),
  });

  assert.equal(
    classifyAutomationModelError(wrapped).classification,
    "dependency_unavailable"
  );
});

test("classifyAutomationModelError leaves an allowlist denial non-retryable", () => {
  const classified = classifyAutomationModelError(
    new Error(MODEL_NOT_IN_ALLOWLIST_ERROR)
  );

  assert.notEqual(classified.classification, "dependency_unavailable");
  assert.equal(classified.retryable, false);
});

test("classifyAutomationModelError treats gateway header timeouts as transient", () => {
  const error = Object.assign(
    new Error("Cannot connect to API: Headers Timeout Error"),
    {
      code: "UND_ERR_HEADERS_TIMEOUT",
    }
  );

  assert.deepEqual(classifyAutomationModelError(error), {
    classification: "timeout",
    retryable: true,
    rawMessage: "Cannot connect to API: Headers Timeout Error",
    message:
      "Automation model request timed out: Cannot connect to API: Headers Timeout Error",
    statusCode: null,
    errorName: "Error",
    errorCode: "UND_ERR_HEADERS_TIMEOUT",
  });
});

test("classifyAutomationModelError strips gateway wrapper noise from aborted timeout errors", () => {
  const error = new Error(
    "Invalid error response format: Gateway request failed: The operation was aborted due to timeout"
  );

  assert.deepEqual(classifyAutomationModelError(error), {
    classification: "timeout",
    retryable: true,
    rawMessage:
      "Gateway request timed out: The operation was aborted due to timeout",
    message:
      "Automation model request timed out: Gateway request timed out: The operation was aborted due to timeout",
    statusCode: null,
    errorName: "Error",
    errorCode: null,
  });
});

test("classifyAutomationModelError treats missing provider keys as configuration failures", () => {
  const error = new Error(
    "No OpenAI API key configured. Add one in Settings > API Keys or configure an AI Gateway key."
  );

  assert.deepEqual(classifyAutomationModelError(error), {
    classification: "configuration",
    retryable: false,
    rawMessage:
      "No OpenAI API key configured. Add one in Settings > API Keys or configure an AI Gateway key.",
    message:
      "Automation model configuration failed: No OpenAI API key configured. Add one in Settings > API Keys or configure an AI Gateway key.",
    statusCode: null,
    errorName: "Error",
    errorCode: null,
  });
});

test("asAutomationModelExecutionError wraps model setup failures with normalized metadata", () => {
  const error = asAutomationModelExecutionError({
    error: new Error(
      "Platform AI access is not enabled for this account. Add your own AI Gateway key or provider key in Settings > API Keys."
    ),
    phase: "issue_triage:model_resolution",
    timeoutMs: 18_000,
  });

  assert.ok(error instanceof AutomationModelExecutionError);
  assert.deepEqual(error.failure, {
    classification: "configuration",
    retryable: false,
    rawMessage:
      "Platform AI access is not enabled for this account. Add your own AI Gateway key or provider key in Settings > API Keys.",
    message:
      "Automation model configuration failed: Platform AI access is not enabled for this account. Add your own AI Gateway key or provider key in Settings > API Keys.",
    statusCode: null,
    errorName: "Error",
    errorCode: null,
  });
  assert.deepEqual(error.metadata, {
    phase: "issue_triage:model_resolution",
    attempts: 0,
    retryCount: 0,
    retried: false,
    effectiveTimeoutMs: AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
    recoveredFromFailureClass: null,
    recoveredFromMessage: null,
    finalFailureClass: "configuration",
    finalFailureMessage:
      "Platform AI access is not enabled for this account. Add your own AI Gateway key or provider key in Settings > API Keys.",
    finalFailureStatusCode: null,
  });
});

test("both cause-chain walkers agree on the allowlist error", () => {
  const tagged = modelAllowlistUnavailableError();
  const cases: Array<{ label: string; error: unknown; expected: boolean }> = [
    { label: "bare tagged error", error: tagged, expected: true },
    {
      label: "wrapped once",
      error: new Error("outer", { cause: modelAllowlistUnavailableError() }),
      expected: true,
    },
    {
      label: "wrapped twice",
      error: new Error("outer", {
        cause: new Error("mid", { cause: modelAllowlistUnavailableError() }),
      }),
      expected: true,
    },
    {
      label: "message only, no code",
      error: new Error(MODEL_ALLOWLIST_UNAVAILABLE_ERROR),
      expected: false,
    },
    {
      label: "unrelated error",
      error: new Error("something else"),
      expected: false,
    },
    { label: "non-object", error: "a string", expected: false },
  ];

  for (const { label, error, expected } of cases) {
    const viaHttpDetector = isModelAllowlistUnavailableError(error);
    const viaClassifier =
      classifyAutomationModelError(error).classification ===
      "dependency_unavailable";

    assert.equal(viaHttpDetector, expected, `http detector: ${label}`);
    assert.equal(viaClassifier, expected, `classifier: ${label}`);
  }
});
