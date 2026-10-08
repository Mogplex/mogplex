import { generateText, tool } from "ai";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { classifyAutomationModelError } from "./automation-model-execution-errors";
import {
  AutomationModelExecutionError,
  executeAutomationTextGeneration,
} from "./automation-model-execution";
import type {
  AutomationGenerateRetryState,
  GenerateTextRequest,
} from "./automation-model-execution-types";
import {
  decideAutomationModelRecovery,
  wrapAutomationModelForRecovery,
} from "./automation-model-failover";

type Outcome = "ok" | "tool" | Error;
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

function generateResult(text: string, modelId: string, callTool = false) {
  return {
    content: callTool
      ? [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "lookup",
            input: "{}",
          },
        ]
      : [{ type: "text", text }],
    finishReason: callTool
      ? { unified: "tool-calls", raw: "tool_calls" }
      : { unified: "stop", raw: "stop" },
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

/** A v4 model that plays back one outcome per call and records its options. */
function scriptedModel(
  modelId: string,
  outcomes: Outcome[],
  onCall?: () => void
) {
  const calls: CallOptions[] = [];
  const model = {
    specificationVersion: "v4" as const,
    provider: "gateway",
    modelId,
    supportedUrls: {},
    async doGenerate(options: CallOptions) {
      calls.push(options);
      onCall?.();
      const outcome = outcomes[calls.length - 1] ?? outcomes.at(-1) ?? "ok";
      if (outcome instanceof Error) throw outcome;
      return generateResult(`${modelId} answered`, modelId, outcome === "tool");
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

function recover(error: Error) {
  return decideAutomationModelRecovery(classifyAutomationModelError(error));
}

describe("decideAutomationModelRecovery", () => {
  it.each([
    ["a dropped connection mid-request", socketDrop()],
    [
      "a reset connection",
      providerError("socket hang up", { code: "ECONNRESET" }),
    ],
    ["a 502", providerError("bad gateway", { statusCode: 502 })],
    ["a 503", providerError("no providers available", { statusCode: 503 })],
    ["a 529", providerError("overloaded", { statusCode: 529 })],
    ["a 429", providerError("rate limited", { statusCode: 429 })],
    ["a 408", providerError("request timeout", { statusCode: 408 })],
    [
      "a body timeout",
      providerError("Body Timeout Error", { code: "UND_ERR_BODY_TIMEOUT" }),
    ],
  ])("should fail over on %s", (_label, error) => {
    expect(recover(error)).toBe("fail_over");
  });

  it.each([
    [
      "ECONNREFUSED",
      providerError("connect refused", { code: "ECONNREFUSED" }),
    ],
    ["ENOTFOUND", providerError("getaddrinfo", { code: "ENOTFOUND" })],
    [
      "UND_ERR_CONNECT_TIMEOUT",
      providerError("Connect Timeout Error", {
        code: "UND_ERR_CONNECT_TIMEOUT",
      }),
    ],
  ])(
    "should retry the same model when the gateway is unreachable (%s)",
    (_label, error) => {
      expect(recover(error)).toBe("retry_same");
    }
  );

  it.each([
    ["a 400", providerError("invalid request", { statusCode: 400 })],
    ["a 401", providerError("Invalid API key", { statusCode: 401 })],
    ["a 402", providerError("insufficient credits", { statusCode: 402 })],
    ["a 403", providerError("forbidden", { statusCode: 403 })],
    ["a 404", providerError("model not found", { statusCode: 404 })],
    ["a 422", providerError("unprocessable", { statusCode: 422 })],
  ])("should fail without switching on %s", (_label, error) => {
    expect(recover(error)).toBe("fail");
  });
});

describe("wrapAutomationModelForRecovery", () => {
  function wrap(
    primary: V4Model,
    fallbacks: { modelId: string; model: V4Model }[],
    retryState = freshRetryState(),
    clock?: { stepBudgetMs: number; now: () => number }
  ) {
    const wrapped = wrapAutomationModelForRecovery({
      model: primary,
      fallbackModels: fallbacks,
      retryState,
      logger: silentLogger,
      logContext: { phase: "pr_review", requestedModelId: "zai/glm-5.3" },
      ...clock,
    }) as V4Model;
    return { wrapped, retryState };
  }

  it("should stop moving down the chain once the step has used its budget", async () => {
    let now = 0;
    const tick = () => {
      now += 600_000;
    };
    const primary = scriptedModel("zai/glm-5.3", [socketDrop()], tick);
    const first = scriptedModel("zai/glm-5.3-fast", [socketDrop()], tick);
    const second = scriptedModel("b", ["ok"], tick);
    const { wrapped, retryState } = wrap(
      primary.model,
      [
        { modelId: "zai/glm-5.3-fast", model: first.model },
        { modelId: "b", model: second.model },
      ],
      freshRetryState(),
      { stepBudgetMs: 1_000_000, now: () => now }
    );

    await expect(wrapped.doGenerate(callOptions)).rejects.toThrow(
      "Gateway request failed"
    );
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
    expect(retryState.failoverModelIds).toEqual(["zai/glm-5.3-fast"]);
  });

  it("should hand the request to the fallback when the primary drops the connection", async () => {
    const primary = scriptedModel("zai/glm-5.3", [socketDrop()]);
    const fallback = scriptedModel("zai/glm-5.3-fast", ["ok"]);
    const { wrapped, retryState } = wrap(primary.model, [
      { modelId: "zai/glm-5.3-fast", model: fallback.model },
    ]);

    const result = await wrapped.doGenerate(callOptions);

    expect(result.content).toEqual([
      { type: "text", text: "zai/glm-5.3-fast answered" },
    ]);
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);
    expect(retryState.failoverModelIds).toEqual(["zai/glm-5.3-fast"]);
  });

  it("should keep later steps on the fallback once the primary has failed", async () => {
    const primary = scriptedModel("zai/glm-5.3", [socketDrop(), "ok"]);
    const fallback = scriptedModel("zai/glm-5.3-fast", ["ok"]);
    const { wrapped } = wrap(primary.model, [
      { modelId: "zai/glm-5.3-fast", model: fallback.model },
    ]);

    await wrapped.doGenerate(callOptions);
    await wrapped.doGenerate(callOptions);

    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(2);
  });

  it("should route the gateway only to models after the active fallback", async () => {
    const primary = scriptedModel("zai/glm-5.3", [socketDrop()]);
    const first = scriptedModel("zai/glm-5.3-fast", [
      providerError("upstream unavailable", { statusCode: 503 }),
    ]);
    const second = scriptedModel("b", ["ok"]);
    const { wrapped, retryState } = wrap(primary.model, [
      { modelId: "zai/glm-5.3-fast", model: first.model },
      { modelId: "b", model: second.model },
    ]);

    await wrapped.doGenerate(callOptions);

    expect(first.calls[0].providerOptions?.gateway).toMatchObject({
      models: ["b"],
    });
    expect(second.calls[0].providerOptions?.gateway).not.toHaveProperty(
      "models"
    );
    expect(retryState.failoverModelIds).toEqual(["zai/glm-5.3-fast", "b"]);
  });

  it("should retry the primary rather than switch when the gateway is unreachable", async () => {
    const primary = scriptedModel("zai/glm-5.3", [
      providerError("connect refused", { code: "ECONNREFUSED" }),
      "ok",
    ]);
    const fallback = scriptedModel("zai/glm-5.3-fast", ["ok"]);
    const { wrapped, retryState } = wrap(primary.model, [
      { modelId: "zai/glm-5.3-fast", model: fallback.model },
    ]);

    await wrapped.doGenerate(callOptions);

    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(0);
    expect(retryState.failoverModelIds).toEqual([]);
  });

  it("should not switch models once the generation's own signal has aborted", async () => {
    const primary = scriptedModel("zai/glm-5.3", [
      providerError("The operation was aborted due to timeout", {
        name: "TimeoutError",
      }),
    ]);
    const fallback = scriptedModel("zai/glm-5.3-fast", ["ok"]);
    const { wrapped, retryState } = wrap(primary.model, [
      { modelId: "zai/glm-5.3-fast", model: fallback.model },
    ]);

    await expect(
      wrapped.doGenerate({ ...callOptions, abortSignal: AbortSignal.abort() })
    ).rejects.toThrow("aborted due to timeout");
    expect(fallback.calls).toHaveLength(0);
    expect(retryState.failoverModelIds).toEqual([]);
    expect(retryState.retryCount).toBe(0);
  });

  it("should not switch models on an authentication failure", async () => {
    const primary = scriptedModel("zai/glm-5.3", [
      providerError("Invalid API key", { statusCode: 401 }),
    ]);
    const fallback = scriptedModel("zai/glm-5.3-fast", ["ok"]);
    const { wrapped } = wrap(primary.model, [
      { modelId: "zai/glm-5.3-fast", model: fallback.model },
    ]);

    await expect(wrapped.doGenerate(callOptions)).rejects.toThrow(
      "Invalid API key"
    );
    expect(fallback.calls).toHaveLength(0);
  });

  it("should retry the last fallback once and then fail when every model is down", async () => {
    const primary = scriptedModel("zai/glm-5.3", [socketDrop()]);
    const fallback = scriptedModel("zai/glm-5.3-fast", [socketDrop()]);
    const { wrapped, retryState } = wrap(primary.model, [
      { modelId: "zai/glm-5.3-fast", model: fallback.model },
    ]);

    await expect(wrapped.doGenerate(callOptions)).rejects.toThrow(
      "Gateway request failed"
    );
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(2);
    expect(retryState.retryCount).toBe(2);
  });
});

describe("executeAutomationTextGeneration fail-over", () => {
  it("should record the fail-over on a successful run", async () => {
    const primary = scriptedModel("zai/glm-5.3", [socketDrop()]);
    const fallback = scriptedModel("zai/glm-5.3-fast", ["ok"]);

    const { result, metadata } = await executeAutomationTextGeneration({
      phase: "pr_review",
      requestedModelId: "zai/glm-5.3",
      fallbackModels: [{ modelId: "zai/glm-5.3-fast", model: fallback.model }],
      generateText,
      logger: silentLogger,
      request: { model: primary.model, prompt: "Review this PR" },
    });

    expect(result.text).toBe("zai/glm-5.3-fast answered");
    expect(metadata).toMatchObject({
      attempts: 2,
      retried: true,
      recoveredFromFailureClass: "provider_unavailable",
      failoverModelIds: ["zai/glm-5.3-fast"],
      fallbackUsed: true,
    });
  });

  it("should record the fail-over on a run that still fails", async () => {
    const primary = scriptedModel("zai/glm-5.3", [socketDrop()]);
    const fallback = scriptedModel("zai/glm-5.3-fast", [socketDrop()]);

    const failure = await executeAutomationTextGeneration({
      phase: "pr_review",
      requestedModelId: "zai/glm-5.3",
      fallbackModels: [{ modelId: "zai/glm-5.3-fast", model: fallback.model }],
      generateText,
      logger: silentLogger,
      request: { model: primary.model, prompt: "Review this PR" },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AutomationModelExecutionError);
    expect((failure as AutomationModelExecutionError).metadata).toMatchObject({
      attempts: 3,
      failoverModelIds: ["zai/glm-5.3-fast"],
      fallbackUsed: true,
      finalFailureClass: "provider_unavailable",
    });
  });

  it("should keep a tool loop on the fallback after a later step fails", async () => {
    const primary = scriptedModel("zai/glm-5.3", ["tool", socketDrop()]);
    const fallback = scriptedModel("zai/glm-5.3-fast", ["ok"]);
    const last = scriptedModel("b", ["ok"]);

    const { result, metadata } = await executeAutomationTextGeneration({
      phase: "pr_review",
      requestedModelId: "zai/glm-5.3",
      fallbackModels: [
        { modelId: "zai/glm-5.3-fast", model: fallback.model },
        { modelId: "b", model: last.model },
      ],
      generateText,
      logger: silentLogger,
      request: {
        model: primary.model,
        prompt: "Review this PR",
        providerOptions: {
          gateway: { models: ["zai/glm-5.3-fast", "b"] },
        },
        tools: {
          lookup: tool({
            inputSchema: z.object({}),
            execute: async () => "found",
          }),
        },
        stopWhen: () => false,
      },
    });

    expect(result.text).toBe("zai/glm-5.3-fast answered");
    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(1);
    expect(fallback.calls[0].providerOptions?.gateway).toMatchObject({
      models: ["b"],
    });
    expect(metadata).toMatchObject({
      failoverModelIds: ["zai/glm-5.3-fast"],
      effectiveModelIds: ["zai/glm-5.3", "zai/glm-5.3-fast"],
    });
  });
});
