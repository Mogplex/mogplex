import assert from "node:assert/strict";
import test from "node:test";
import { streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  loadHandler,
  parseSsePayloads,
} from "./helpers/cli-inference-handler-fixtures";
import { toAiTools } from "../../app/api/cli/inference/chat/completions/message-conversion";

test("the CLI bridge converts SDK 7 text, tool calls, and usage into OpenAI SSE", async () => {
  const { createOpenAiChatCompletionStream, toModelMessages } =
    await loadHandler();
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "answer" });
          controller.enqueue({
            type: "text-delta",
            id: "answer",
            delta: "Inspecting the file.",
          });
          controller.enqueue({ type: "text-end", id: "answer" });
          controller.enqueue({
            type: "tool-call",
            toolCallId: "read-1",
            toolName: "read_file",
            input: '{"path":"README.md"}',
          });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: {
              inputTokens: {
                total: 10,
                noCache: 7,
                cacheRead: 3,
                cacheWrite: 0,
              },
              outputTokens: { total: 4, text: 3, reasoning: 1 },
            },
          });
          controller.close();
        },
      }),
    }),
  });
  const response = createOpenAiChatCompletionStream({
    createResult: () =>
      streamText({
        model,
        messages: toModelMessages([
          { role: "user", content: "Inspect README.md" },
        ]),
        tools: toAiTools([
          {
            type: "function",
            function: {
              name: "read_file",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          },
        ]),
      }),
    responseId: "chatcmpl_sdk7",
    created: 1,
    modelId: "test/sdk7",
  });
  const payloads = parseSsePayloads(await response.text());
  assert.equal(payloads.at(-1), "[DONE]");
  const frames = payloads.slice(0, -1).map((payload) => JSON.parse(payload));
  assert.deepEqual(
    frames.filter((frame) => frame.error),
    []
  );
  assert.ok(
    frames.some(
      (frame) => frame.choices[0].delta.content === "Inspecting the file."
    )
  );
  assert.ok(
    frames.some((frame) =>
      frame.choices[0].delta.tool_calls?.some(
        (call: { id?: string; function?: { name?: string } }) =>
          call.id === "read-1" && call.function?.name === "read_file"
      )
    )
  );
  assert.equal(frames.at(-1).choices[0].finish_reason, "tool_calls");
  assert.deepEqual(frames.at(-1).usage, {
    prompt_tokens: 10,
    completion_tokens: 4,
    total_tokens: 14,
  });
});

test("CLI image messages use SDK 7 file data without discarding the image", async () => {
  const { toModelMessages } = await loadHandler();
  assert.deepEqual(
    toModelMessages([
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,iVBORw==" },
          },
        ],
      },
    ]),
    [
      {
        role: "user",
        content: [
          {
            type: "file",
            mediaType: "image",
            data: {
              type: "url",
              url: new URL("data:image/png;base64,iVBORw=="),
            },
          },
        ],
      },
    ]
  );
});
