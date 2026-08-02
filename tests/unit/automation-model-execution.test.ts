import assert from "node:assert/strict";
import test from "node:test";
import { generateText as aiGenerateText } from "ai";
import { Agent } from "undici";
import {
  AUTOMATION_DISPATCHER_CACHE_MAX_ENTRIES,
  AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS,
  AUTOMATION_MODEL_DEFAULT_TOTAL_BUDGET_MS,
  AUTOMATION_MODEL_MAX_GENERATE_RETRIES,
  AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
  AutomationModelExecutionError,
  asAutomationModelExecutionError,
  buildAutomationProviderFetch,
  classifyAutomationModelError,
  executeAutomationTextGeneration,
  getEffectiveAutomationTimeoutMs,
  resetAutomationDispatcherCacheForTests,
} from "../../lib/workflows/automation-model-execution";
import { getAutomationModelFallbackIds } from "../../lib/workflows/automation-model-defaults";
import {
  isModelAllowlistUnavailableError,
  MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
  MODEL_NOT_IN_ALLOWLIST_ERROR,
  modelAllowlistUnavailableError,
} from "../../lib/team-capabilities";

test.afterEach(() => {
  resetAutomationDispatcherCacheForTests();
});

type AutomationExecutionInput = Parameters<
  typeof executeAutomationTextGeneration
>[0];
type TestAutomationModel = Extract<
  AutomationExecutionInput["request"]["model"],
  { specificationVersion: "v3" }
>;

function createSuccessfulModelResult(
  text = "done",
  providerMetadata?: Record<string, unknown>
) {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: {
        total: 1,
        noCache: 1,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: {
        total: 1,
        text: 1,
        reasoning: 0,
      },
    },
    request: {},
    response: {
      id: "resp-1",
      timestamp: new Date("2026-04-13T00:00:00.000Z"),
      modelId: "retry-model",
    },
    warnings: undefined,
    providerMetadata,
  } as never;
}

function createTestAutomationModel(input?: {
  onGenerate?: (callNumber: number) => Promise<unknown> | unknown;
}) {
  let doGenerateCalls = 0;

  const model = {
    specificationVersion: "v3" as const,
    provider: "test-provider",
    modelId: "retry-model",
    supportedUrls: {},
    async doGenerate() {
      doGenerateCalls += 1;

      if (input?.onGenerate) {
        return input.onGenerate(doGenerateCalls) as never;
      }

      return createSuccessfulModelResult();
    },
    async doStream() {
      throw new Error("doStream should not be called");
    },
  } as TestAutomationModel;

  return {
    model,
    getDoGenerateCallCount() {
      return doGenerateCalls;
    },
  };
}

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

test("classifyAutomationModelError marks an unreadable team allowlist transient", () => {
  // The allowlist gate fails closed, so a Supabase blip reaches the automation
  // path as an error, and it landed in "unknown" — wrong label, wrong message.
  // Recovery for this class is loadTeamAllowlistState's read retry, not anything
  // keyed off this name — the job aborts either way, because by then it has
  // already published a check run and written telemetry.
  const classified = classifyAutomationModelError(
    modelAllowlistUnavailableError()
  );

  assert.equal(classified.classification, "dependency_unavailable");
  assert.equal(classified.retryable, true);
  // Not "provider was unavailable": the model provider is fine, and that
  // wording would send an operator to the wrong dashboard.
  assert.equal(
    classified.message,
    `Automation could not verify run policy: ${MODEL_ALLOWLIST_UNAVAILABLE_ERROR}`
  );
});

test("classifyAutomationModelError keys the allowlist class off the code, not the copy", () => {
  // The message is end-user copy and will get reworded. If classification read
  // it, that rewording would silently drop these back into "unknown" — the
  // exact misclassification the class exists to fix. Pinned in both
  // directions: the code alone is enough, and the message alone is not.
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
  // The code check runs first precisely so a message/status heuristic cannot
  // steal the classification. This error would match the timeout heuristic on
  // its message and the provider-unavailable one on its status — the exact
  // signal has to win over both.
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
  // Resolution errors get re-thrown further up, so the code has to survive
  // wrapping — readErrorCode walks the cause chain for exactly this.
  const wrapped = new Error("Automation model resolution failed", {
    cause: modelAllowlistUnavailableError(),
  });

  assert.equal(
    classifyAutomationModelError(wrapped).classification,
    "dependency_unavailable"
  );
});

test("classifyAutomationModelError leaves an allowlist denial non-retryable", () => {
  // The sibling case must not get swept in: "not permitted" is a permanent
  // decision, and retrying it just burns the budget.
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

test("buildAutomationProviderFetch scopes transport state to the effective timeout", async () => {
  const originalFetch = globalThis.fetch;
  let firstInit: (RequestInit & { dispatcher?: unknown }) | null = null;
  let secondInit: (RequestInit & { dispatcher?: unknown }) | null = null;

  try {
    let call = 0;
    globalThis.fetch = (async (_input, init) => {
      call += 1;
      if (call === 1) {
        firstInit = init as RequestInit & { dispatcher?: unknown };
      } else {
        secondInit = init as RequestInit & { dispatcher?: unknown };
      }

      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const flooredFetch = buildAutomationProviderFetch({ timeoutMs: 18_000 });
    const extendedFetch = buildAutomationProviderFetch({ timeoutMs: 360_000 });

    await flooredFetch("https://example.com/first");
    await extendedFetch("https://example.com/second");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(firstInit);
  assert.ok(secondInit);
  const capturedFirstInit = firstInit as RequestInit & { dispatcher?: unknown };
  const capturedSecondInit = secondInit as RequestInit & {
    dispatcher?: unknown;
  };
  assert.ok(capturedFirstInit.signal);
  assert.ok(capturedSecondInit.signal);
  assert.ok(capturedFirstInit.dispatcher instanceof Agent);
  assert.ok(capturedSecondInit.dispatcher instanceof Agent);
  assert.notEqual(capturedFirstInit.dispatcher, capturedSecondInit.dispatcher);
});

test("buildAutomationProviderFetch evicts least recently used dispatchers", async () => {
  const originalFetch = globalThis.fetch;
  const capturedDispatchers: unknown[] = [];
  const baseTimeoutMs = 350_000;

  try {
    globalThis.fetch = (async (_input, init) => {
      capturedDispatchers.push(
        (init as RequestInit & { dispatcher?: unknown }).dispatcher
      );
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    for (
      let index = 0;
      index < AUTOMATION_DISPATCHER_CACHE_MAX_ENTRIES;
      index += 1
    ) {
      const timeoutMs = baseTimeoutMs + index;
      await buildAutomationProviderFetch({ timeoutMs })(
        `https://example.com/${timeoutMs}`
      );
    }

    const firstDispatcher = capturedDispatchers[0];

    await buildAutomationProviderFetch({
      timeoutMs: baseTimeoutMs + AUTOMATION_DISPATCHER_CACHE_MAX_ENTRIES,
    })("https://example.com/overflow");

    await buildAutomationProviderFetch({ timeoutMs: baseTimeoutMs })(
      "https://example.com/rebuild"
    );

    const rebuiltFirstDispatcher = capturedDispatchers.at(-1);
    assert.ok(firstDispatcher instanceof Agent);
    assert.ok(rebuiltFirstDispatcher instanceof Agent);
    assert.notEqual(rebuiltFirstDispatcher, firstDispatcher);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("executeAutomationTextGeneration records single-attempt success metadata", async () => {
  const testModel = createTestAutomationModel();
  const { result, metadata } = await executeAutomationTextGeneration({
    phase: "pr_review",
    timeoutMs: 18_000,
    generateText: aiGenerateText,
    request: {
      model: testModel.model,
      prompt: "Review this PR",
    },
  });

  assert.equal(testModel.getDoGenerateCallCount(), 1);
  assert.equal(result.text, "done");
  assert.deepEqual(metadata, {
    phase: "pr_review",
    attempts: 1,
    retryCount: 0,
    retried: false,
    effectiveTimeoutMs: AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
    recoveredFromFailureClass: null,
    recoveredFromMessage: null,
    finalFailureClass: null,
    finalFailureMessage: null,
    finalFailureStatusCode: null,
    observedInputTokens: 1,
    observedOutputTokens: 1,
    observedUsage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      reasoningTokens: 0,
      generationId: null,
      generationIds: [],
    },
  });
});

test("executeAutomationTextGeneration records gateway model fallback routing", async () => {
  const testModel = createTestAutomationModel({
    onGenerate() {
      return createSuccessfulModelResult("fallback response", {
        gateway: {
          generationId: "gen-fallback",
          modelAttempts: [
            {
              canonicalSlug: "xai/grok-4.5",
              modelId: "xai:grok-4-5",
              success: false,
              providerAttemptCount: 1,
            },
            {
              canonicalSlug: "zai/glm-5.2-fast",
              modelId: "fireworks:glm-5p2-fast",
              success: true,
              providerAttemptCount: 1,
            },
          ],
        },
      });
    },
  });

  const { result, metadata } = await executeAutomationTextGeneration({
    phase: "pr_review",
    requestedModelId: "xai/grok-4.5",
    timeoutMs: 18_000,
    generateText: aiGenerateText,
    request: {
      model: testModel.model,
      prompt: "Review this PR",
    },
  });

  assert.equal(result.text, "fallback response");
  assert.equal(testModel.getDoGenerateCallCount(), 1);
  assert.equal(metadata.attempts, 1);
  assert.equal(metadata.retryCount, 0);
  assert.equal(metadata.retried, false);
  assert.equal(metadata.requestedModelId, "xai/grok-4.5");
  assert.deepEqual(metadata.gatewayModelAttempts, [
    {
      canonicalSlug: "xai/grok-4.5",
      modelId: "xai:grok-4-5",
      success: false,
      providerAttemptCount: 1,
    },
    {
      canonicalSlug: "zai/glm-5.2-fast",
      modelId: "fireworks:glm-5p2-fast",
      success: true,
      providerAttemptCount: 1,
    },
  ]);
  assert.equal(metadata.gatewayModelAttemptCount, 2);
  assert.deepEqual(metadata.effectiveModelIds, ["zai/glm-5.2-fast"]);
  assert.equal(metadata.fallbackUsed, true);
});

test("executeAutomationTextGeneration does not retry transient failures when the model cannot be wrapped", async () => {
  let attempts = 0;

  await assert.rejects(
    () =>
      executeAutomationTextGeneration({
        phase: "pr_review",
        timeoutMs: 18_000,
        generateText: async () => {
          attempts += 1;
          throw Object.assign(
            new Error("Cannot connect to API: Headers Timeout Error"),
            {
              code: "UND_ERR_HEADERS_TIMEOUT",
            }
          );
        },
        request: {
          model: "openai/gpt-5.4" as never,
          prompt: "Review this PR",
        },
      }),
    (error: unknown) => {
      assert.equal(attempts, 1);
      assert.ok(error instanceof AutomationModelExecutionError);
      assert.equal(error.failure.classification, "timeout");
      assert.deepEqual(error.metadata, {
        phase: "pr_review",
        attempts: 1,
        retryCount: 0,
        retried: false,
        effectiveTimeoutMs: AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
        recoveredFromFailureClass: null,
        recoveredFromMessage: null,
        finalFailureClass: "timeout",
        finalFailureMessage: "Cannot connect to API: Headers Timeout Error",
        finalFailureStatusCode: null,
      });
      return true;
    }
  );
});

test("executeAutomationTextGeneration preserves observed usage on timeout failures", async () => {
  await assert.rejects(
    () =>
      executeAutomationTextGeneration({
        phase: "pr_review",
        timeoutMs: 18_000,
        generateText: async (request) => {
          await request.onStepFinish?.({
            usage: {
              inputTokens: 13,
              outputTokens: 4,
            },
          } as never);
          throw Object.assign(
            new Error("Cannot connect to API: Headers Timeout Error"),
            {
              code: "UND_ERR_HEADERS_TIMEOUT",
            }
          );
        },
        request: {
          model: "openai/gpt-5.4" as never,
          prompt: "Review this PR",
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof AutomationModelExecutionError);
      assert.deepEqual(error.metadata, {
        phase: "pr_review",
        attempts: 1,
        retryCount: 0,
        retried: false,
        effectiveTimeoutMs: AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
        observedInputTokens: 13,
        observedOutputTokens: 4,
        observedUsage: {
          inputTokens: 13,
          outputTokens: 4,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          reasoningTokens: null,
          generationId: null,
          generationIds: [],
        },
        recoveredFromFailureClass: null,
        recoveredFromMessage: null,
        finalFailureClass: "timeout",
        finalFailureMessage: "Cannot connect to API: Headers Timeout Error",
        finalFailureStatusCode: null,
      });
      return true;
    }
  );
});

test("executeAutomationTextGeneration retries transient v3 model failures once", async () => {
  const testModel = createTestAutomationModel({
    onGenerate(callNumber) {
      if (callNumber === 1) {
        throw Object.assign(
          new Error("Cannot connect to API: Headers Timeout Error"),
          {
            code: "UND_ERR_HEADERS_TIMEOUT",
          }
        );
      }

      return createSuccessfulModelResult("recovered");
    },
  });

  const { result, metadata } = await executeAutomationTextGeneration({
    phase: "pr_review",
    timeoutMs: 18_000,
    generateText: aiGenerateText,
    request: {
      model: testModel.model,
      prompt: "Review this PR",
    },
  });

  assert.equal(testModel.getDoGenerateCallCount(), 2);
  assert.equal(result.text, "recovered");
  assert.deepEqual(metadata, {
    phase: "pr_review",
    attempts: 2,
    retryCount: 1,
    retried: true,
    effectiveTimeoutMs: AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
    recoveredFromFailureClass: "timeout",
    recoveredFromMessage: "Cannot connect to API: Headers Timeout Error",
    finalFailureClass: null,
    finalFailureMessage: null,
    finalFailureStatusCode: null,
    observedInputTokens: 1,
    observedOutputTokens: 1,
    observedUsage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      reasoningTokens: 0,
      generationId: null,
      generationIds: [],
    },
  });
});

test("executeAutomationTextGeneration does not retry authentication failures for v3 models", async () => {
  const testModel = createTestAutomationModel({
    onGenerate() {
      throw Object.assign(new Error("Invalid API key"), {
        statusCode: 401,
        name: "GatewayAuthenticationError",
      });
    },
  });

  await assert.rejects(
    () =>
      executeAutomationTextGeneration({
        phase: "pr_review",
        timeoutMs: null,
        generateText: aiGenerateText,
        request: {
          model: testModel.model,
          prompt: "Review this PR",
        },
      }),
    (error: unknown) => {
      assert.equal(testModel.getDoGenerateCallCount(), 1);
      assert.ok(error instanceof AutomationModelExecutionError);
      assert.equal(error.failure.classification, "authentication");
      assert.equal(error.metadata.retried, false);
      assert.equal(error.metadata.finalFailureClass, "authentication");
      return true;
    }
  );
});

test("executeAutomationTextGeneration records final provider failures after one retry", async () => {
  const testModel = createTestAutomationModel({
    onGenerate() {
      throw Object.assign(new Error("upstream unavailable"), {
        statusCode: 503,
        name: "GatewayInternalServerError",
      });
    },
  });

  await assert.rejects(
    () =>
      executeAutomationTextGeneration({
        phase: "pr_fix",
        timeoutMs: null,
        generateText: aiGenerateText,
        request: {
          model: testModel.model,
          prompt: "Apply a fix",
        },
      }),
    (error: unknown) => {
      assert.equal(testModel.getDoGenerateCallCount(), 2);
      assert.ok(error instanceof AutomationModelExecutionError);
      assert.equal(error.failure.classification, "provider_unavailable");
      assert.deepEqual(error.metadata, {
        phase: "pr_fix",
        attempts: 2,
        retryCount: 1,
        retried: true,
        effectiveTimeoutMs: AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS,
        recoveredFromFailureClass: "provider_unavailable",
        recoveredFromMessage: "upstream unavailable",
        finalFailureClass: "provider_unavailable",
        finalFailureMessage: "upstream unavailable",
        finalFailureStatusCode: 503,
      });
      return true;
    }
  );
});

test("both cause-chain walkers agree on the allowlist error", () => {
  // Two independent implementations detect the same code: readErrorCode here
  // (walking the chain buildAutomationErrorSignals assembles) and
  // isModelAllowlistUnavailableError in team-capabilities. They gate different
  // things — retry classification and HTTP status — and the PR's argument is
  // that they must never disagree, so pin it rather than trusting two readings
  // of two files.
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
