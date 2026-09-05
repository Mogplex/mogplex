import { expect, it } from "vitest";
import { streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { controlMessageMetadata } from "./context-usage";

it("publishes one current-step measurement through the real SDK without multiplying text chunks", async () => {
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "answer" });
          for (const delta of ["Ready", " to", " continue."])
            controller.enqueue({ type: "text-delta", id: "answer", delta });
          controller.enqueue({ type: "text-end", id: "answer" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: {
                total: 10000,
                noCache: 8000,
                cacheRead: 2000,
                cacheWrite: 0,
              },
              outputTokens: { total: 240, text: 200, reasoning: 40 },
            },
          });
          controller.close();
        },
      }),
    }),
  });
  const chunks = [];
  for await (const chunk of streamText({
    model,
    prompt: "Hello",
  }).toUIMessageStream({
    messageMetadata: ({ part }) =>
      controlMessageMetadata("call", "model", part),
  }))
    chunks.push(chunk);
  expect(
    chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.delta)
  ).toEqual(["Ready", " to", " continue."]);
  expect(chunks.filter((chunk) => chunk.type === "message-metadata")).toEqual([
    {
      type: "message-metadata",
      messageMetadata: {
        ai_call_id: "call",
        context: { model: "model", inputTokens: 10000, outputTokens: 240 },
      },
    },
  ]);
});
