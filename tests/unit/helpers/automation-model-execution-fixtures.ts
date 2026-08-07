import { resetAutomationDispatcherCacheForTests } from "../../../lib/workflows/automation-model-execution";

export type AutomationExecutionInput = Parameters<
  typeof import("../../../lib/workflows/automation-model-execution").executeAutomationTextGeneration
>[0];

export type TestAutomationModel = Extract<
  AutomationExecutionInput["request"]["model"],
  { specificationVersion: "v3" }
>;

export function createSuccessfulModelResult(
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

export function createTestAutomationModel(input?: {
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

export function resetDispatcherCache() {
  resetAutomationDispatcherCacheForTests();
}

export { Agent } from "undici";
