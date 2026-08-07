import assert from "node:assert/strict";
import test from "node:test";
import { generateText as aiGenerateText } from "ai";
import {
  AUTOMATION_DISPATCHER_CACHE_MAX_ENTRIES,
  AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS,
  AUTOMATION_MODEL_TIMEOUT_FLOOR_MS,
  AutomationModelExecutionError,
  buildAutomationProviderFetch,
  executeAutomationTextGeneration,
} from "../../lib/workflows/automation-model-execution";
import {
  createSuccessfulModelResult,
  createTestAutomationModel,
  resetDispatcherCache,
  Agent,
} from "./helpers/automation-model-execution-fixtures";

test.afterEach(() => {
  resetDispatcherCache();
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
