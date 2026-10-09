/**
 * Tests for fail-over logging, retried/failedOver semantics, and budget ceiling.
 * Split from automation-model-failover.test.ts to stay under 500 lines.
 */
import { describe, expect, it } from "vitest";
import type {
  AutomationGenerateRetryState,
  GenerateTextRequest,
} from "./automation-model-execution-types";
import { wrapAutomationModelForRecovery } from "./automation-model-failover";

type V4Model = Extract<
  GenerateTextRequest["model"],
  { specificationVersion: "v4" }
>;
type CallOptions = Parameters<V4Model["doGenerate"]>[0];

const silentLogger = { warn: () => {}, error: () => {} };

function providerError(
  message: string,
  fields: { statusCode?: number; code?: string; name?: string }
) {
  return Object.assign(new Error(message), fields);
}

const socketDrop = () =>
  providerError("Gateway request failed", {
    statusCode: 500,
    code: "UND_ERR_SOCKET",
    name: "GatewayResponseError",
  });

function generateResult(text: string, modelId: string) {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    providerMetadata: {
      gateway: { modelAttempts: [{ canonicalSlug: modelId, success: true }] },
    },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  } as never;
}

function scriptedModel(modelId: string, outcomes: (Error | "ok")[]) {
  const calls: CallOptions[] = [];
  const model = {
    specificationVersion: "v4" as const,
    provider: "gateway",
    modelId,
    supportedUrls: {},
    async doGenerate(options: CallOptions) {
      calls.push(options);
      const outcome = outcomes[calls.length - 1] ?? outcomes.at(-1) ?? "ok";
      if (outcome instanceof Error) throw outcome;
      return generateResult(`${modelId} answered`, modelId);
    },
    async doStream() {
      throw new Error("doStream should not be called");
    },
  } as V4Model;
  return { model, calls };
}

function freshRetryState(): AutomationGenerateRetryState {
  return {
    retryCount: 0,
    recoveredFromFailureClass: null,
    recoveredFromMessage: null,
    failoverModelIds: [],
  };
}

const callOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "Review" }] }],
  providerOptions: {
    gateway: { user: "u", sort: "tps", models: ["zai/glm-5.3-fast", "b"] },
  },
} as CallOptions;

describe("failover logging", () => {
  it("should log fromModelId when failing over from primary to first fallback", async () => {
    const logs: { fromModelId: string; toModelId: string }[] = [];
    const captureLogger = {
      warn: (_msg: string, payload: Record<string, unknown>) => {
        if (payload.event === "automation_model_failover") {
          logs.push({
            fromModelId: payload.fromModelId as string,
            toModelId: payload.toModelId as string,
          });
        }
      },
      error: () => {},
    };
    const primary = scriptedModel("zai/glm-5.3", [socketDrop()]);
    const fallback = scriptedModel("zai/glm-5.3-fast", ["ok"]);

    const wrapped = wrapAutomationModelForRecovery({
      model: primary.model,
      fallbackModels: [{ modelId: "zai/glm-5.3-fast", model: fallback.model }],
      retryState: freshRetryState(),
      logger: captureLogger,
      logContext: { phase: "pr_review", requestedModelId: "zai/glm-5.3" },
    }) as V4Model;

    await wrapped.doGenerate(callOptions);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      fromModelId: "zai/glm-5.3",
      toModelId: "zai/glm-5.3-fast",
    });
  });

  it("should log A → B when double failover happens (primary → A → B)", async () => {
    const logs: { fromModelId: string; toModelId: string }[] = [];
    const captureLogger = {
      warn: (_msg: string, payload: Record<string, unknown>) => {
        if (payload.event === "automation_model_failover") {
          logs.push({
            fromModelId: payload.fromModelId as string,
            toModelId: payload.toModelId as string,
          });
        }
      },
      error: () => {},
    };
    const primary = scriptedModel("zai/glm-5.3", [socketDrop()]);
    const first = scriptedModel("zai/glm-5.3-fast", [socketDrop()]);
    const second = scriptedModel("b", ["ok"]);

    const wrapped = wrapAutomationModelForRecovery({
      model: primary.model,
      fallbackModels: [
        { modelId: "zai/glm-5.3-fast", model: first.model },
        { modelId: "b", model: second.model },
      ],
      retryState: freshRetryState(),
      logger: captureLogger,
      logContext: { phase: "pr_review", requestedModelId: "zai/glm-5.3" },
    }) as V4Model;

    await wrapped.doGenerate(callOptions);

    expect(logs).toHaveLength(2);
    expect(logs[0]).toEqual({
      fromModelId: "zai/glm-5.3",
      toModelId: "zai/glm-5.3-fast",
    });
    expect(logs[1]).toEqual({
      fromModelId: "zai/glm-5.3-fast",
      toModelId: "b",
    });
  });
});

describe("retried vs failedOver semantics", () => {
  it("should have retried=false and failedOver=true for pure failover", async () => {
    const primary = scriptedModel("zai/glm-5.3", [socketDrop()]);
    const fallback = scriptedModel("zai/glm-5.3-fast", ["ok"]);
    const retryState = freshRetryState();

    const wrapped = wrapAutomationModelForRecovery({
      model: primary.model,
      fallbackModels: [{ modelId: "zai/glm-5.3-fast", model: fallback.model }],
      retryState,
      logger: silentLogger,
      logContext: { phase: "pr_review", requestedModelId: "zai/glm-5.3" },
    }) as V4Model;

    await wrapped.doGenerate(callOptions);

    // One failover (primary → fallback), no same-model retries
    expect(retryState.retryCount).toBe(1);
    expect(retryState.failoverModelIds).toEqual(["zai/glm-5.3-fast"]);
    // sameModelRetryCount = retryCount - failoverModelIds.length = 1 - 1 = 0
  });

  it("should have retried=true when a same-model retry happens before failover", async () => {
    // Primary fails with gateway unreachable (retry same), then drops (failover)
    const primary = scriptedModel("zai/glm-5.3", [
      providerError("connect refused", { code: "ECONNREFUSED" }),
      socketDrop(),
    ]);
    const fallback = scriptedModel("zai/glm-5.3-fast", ["ok"]);
    const retryState = freshRetryState();

    const wrapped = wrapAutomationModelForRecovery({
      model: primary.model,
      fallbackModels: [{ modelId: "zai/glm-5.3-fast", model: fallback.model }],
      retryState,
      logger: silentLogger,
      logContext: { phase: "pr_review", requestedModelId: "zai/glm-5.3" },
    }) as V4Model;

    await wrapped.doGenerate(callOptions);

    // Two retries total: one same-model retry, then one failover
    expect(retryState.retryCount).toBe(2);
    expect(retryState.failoverModelIds).toEqual(["zai/glm-5.3-fast"]);
    // sameModelRetryCount = retryCount - failoverModelIds.length = 2 - 1 = 1
  });
});

describe("step budget ceiling", () => {
  it("should abort a fallback model request when the budget expires", async () => {
    const primary = scriptedModel("zai/glm-5.3", [socketDrop()]);
    let fallbackAborted = false;
    const fallbackModel = {
      specificationVersion: "v4" as const,
      provider: "gateway",
      modelId: "zai/glm-5.3-fast",
      supportedUrls: {},
      async doGenerate(options: CallOptions) {
        await new Promise<void>((resolve, reject) => {
          const abortHandler = () => {
            fallbackAborted = true;
            reject(new Error("aborted due to budget"));
          };
          if (options.abortSignal?.aborted) {
            abortHandler();
            return;
          }
          options.abortSignal?.addEventListener("abort", abortHandler);
          // This request would take 500ms, but the budget is only 50ms
          setTimeout(() => resolve(), 500);
        });
        return generateResult("should not reach", "zai/glm-5.3-fast");
      },
      async doStream() {
        throw new Error("doStream should not be called");
      },
    } as V4Model;

    const wrapped = wrapAutomationModelForRecovery({
      model: primary.model,
      fallbackModels: [{ modelId: "zai/glm-5.3-fast", model: fallbackModel }],
      retryState: freshRetryState(),
      logger: silentLogger,
      logContext: { phase: "pr_review", requestedModelId: "zai/glm-5.3" },
      stepBudgetMs: 50,
    }) as V4Model;

    // The primary fails immediately, we fail over to fallback
    // The fallback takes 500ms, but the budget is only 50ms
    await expect(wrapped.doGenerate(callOptions)).rejects.toThrow(
      "Step budget exhausted during request"
    );
    expect(fallbackAborted).toBe(true);
  });

  it("should not fail over to the second fallback after a budget abort", async () => {
    // The effective pin here is the catch-time `stepBudgetSpent` check: by the
    // time the budget controller fires, now() - stepStartedAt >= stepBudgetMs,
    // so planNextAttempt receives stepBudgetSpent = true and returns "fail"
    // regardless of error classification. The budgetAborted check inside
    // generationAborted is defense-in-depth for edge cases (e.g. non-integer
    // clock drift), not the primary guard.
    const primary = scriptedModel("zai/glm-5.3", [socketDrop()]);
    let firstFallbackCalled = false;
    let secondFallbackCalled = false;

    const firstFallbackModel = {
      specificationVersion: "v4" as const,
      provider: "gateway",
      modelId: "zai/glm-5.3-fast",
      supportedUrls: {},
      async doGenerate(options: CallOptions) {
        firstFallbackCalled = true;
        await new Promise<void>((resolve, reject) => {
          const abortHandler = () => reject(new Error("aborted due to budget"));
          if (options.abortSignal?.aborted) {
            abortHandler();
            return;
          }
          options.abortSignal?.addEventListener("abort", abortHandler);
          setTimeout(() => resolve(), 500);
        });
        return generateResult("should not reach", "zai/glm-5.3-fast");
      },
      async doStream() {
        throw new Error("doStream should not be called");
      },
    } as V4Model;

    const secondFallbackModel = {
      specificationVersion: "v4" as const,
      provider: "gateway",
      modelId: "b",
      supportedUrls: {},
      async doGenerate() {
        secondFallbackCalled = true;
        return generateResult("second fallback", "b");
      },
      async doStream() {
        throw new Error("doStream should not be called");
      },
    } as V4Model;

    const wrapped = wrapAutomationModelForRecovery({
      model: primary.model,
      fallbackModels: [
        { modelId: "zai/glm-5.3-fast", model: firstFallbackModel },
        { modelId: "b", model: secondFallbackModel },
      ],
      retryState: freshRetryState(),
      logger: silentLogger,
      logContext: { phase: "pr_review", requestedModelId: "zai/glm-5.3" },
      stepBudgetMs: 50,
    }) as V4Model;

    await expect(wrapped.doGenerate(callOptions)).rejects.toThrow(
      "Step budget exhausted"
    );
    expect(firstFallbackCalled).toBe(true);
    expect(secondFallbackCalled).toBe(false);
  });
});
