import assert from "node:assert/strict";
import test from "node:test";
import { streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { createWorkspaceChatResponse } from "../../app/api/chat/_lib/response";

for (const actualModel of ["provider/model", "provider/fallback"]) {
  test(`workspace chat measures the actual responding model: ${actualModel}`, async () => {
    const model = new MockLanguageModelV3({
      modelId: actualModel,
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "answer" });
            controller.enqueue({
              type: "text-delta",
              id: "answer",
              delta: "Done.",
            });
            controller.enqueue({ type: "text-end", id: "answer" });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 25000,
                  noCache: 20000,
                  cacheRead: 5000,
                  cacheWrite: 0,
                },
                outputTokens: { total: 600, text: 500, reasoning: 100 },
              },
            });
            controller.close();
          },
        }),
      }),
    });
    const response = createWorkspaceChatResponse(
      streamText({ model, prompt: "Hello" }),
      "call",
      "provider/model"
    );
    const chunks = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
    assert.deepEqual(
      chunks.find(
        (chunk) =>
          chunk.type === "message-metadata" &&
          (chunk.messageMetadata as { context?: unknown })?.context
      )?.messageMetadata,
      {
        ai_call_id: "call",
        context: {
          model: actualModel,
          inputTokens: 25000,
          outputTokens: 600,
        },
      }
    );
    assert.equal(
      chunks.filter((chunk) => chunk.type === "text-delta").length,
      1
    );
  });
}
