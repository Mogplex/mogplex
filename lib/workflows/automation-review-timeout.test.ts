import { afterEach, expect, it, vi } from "vitest";
import { generateText, tool } from "ai";
import { z } from "zod";
import { executeAutomationTextGeneration } from "./automation-model-execution";
import {
  createSuccessfulModelResult,
  createTestAutomationModel,
} from "@/tests/unit/helpers/automation-model-execution-fixtures";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("finishes a progressing review that takes more than 25 minutes across model steps", async () => {
  vi.useFakeTimers();
  // Native AbortSignal timers bypass Vitest's clock.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(
      () => controller.abort(new DOMException("Timed out", "TimeoutError")),
      ms
    );
    return controller.signal;
  });
  let reads = 0;
  const model = createTestAutomationModel({
    onGenerate: async (call) => {
      await new Promise((resolve) => setTimeout(resolve, 10 * 60_000));
      if (call > 2) return createSuccessfulModelResult("Review completed");
      return {
        ...(createSuccessfulModelResult() as Awaited<
          ReturnType<
            ReturnType<typeof createTestAutomationModel>["model"]["doGenerate"]
          >
        >),
        content: [
          {
            type: "tool-call",
            toolCallId: `read-${call}`,
            toolName: "read",
            input: "{}",
          },
        ],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
      };
    },
  });
  const pending = executeAutomationTextGeneration({
    phase: "pr_review",
    generateText,
    request: {
      model: {
        ...model.model,
        async doGenerate(
          options: Parameters<typeof model.model.doGenerate>[0]
        ) {
          options.abortSignal?.throwIfAborted();
          const result = await model.model.doGenerate(options);
          // Model providers observe request cancellation, including while a
          // response is arriving. The fake clock must exercise that boundary.
          options.abortSignal?.throwIfAborted();
          return result;
        },
      },
      prompt: "Review",
      stopWhen: () => false,
      tools: {
        read: tool({
          inputSchema: z.object({}),
          execute: async () => ({ file: ++reads }),
        }),
      },
    },
  })
    .then(({ result }) => result.text)
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(31 * 60_000);
  expect(await pending).toBe("Review completed");
  expect(reads).toBe(2);
});
