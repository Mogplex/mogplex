import { expect, it } from "vitest";
import { jsonSchema, streamText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { CHAT_STOP_WHEN } from "./run-chat";

it.each([false, true])(
  "uncapped tool loops retain model completion and cancellation (cancel=%s)",
  async (cancel) => {
    let steps = 0;
    let calls = 0;
    const controller = new AbortController();
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(sink) {
            steps += 1;
            const done = steps === 176;
            if (!done)
              sink.enqueue({
                type: "tool-call",
                toolCallId: `read-${steps}`,
                toolName: "read_file",
                input: "{}",
              });
            sink.enqueue({
              type: "finish",
              finishReason: {
                unified: done ? "stop" : "tool-calls",
                raw: done ? "stop" : "tool-calls",
              },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            });
            sink.close();
          },
        }),
      }),
    });
    const result = streamText({
      model,
      prompt: "Finish the task",
      abortSignal: controller.signal,
      tools: {
        read_file: tool({
          inputSchema: jsonSchema<Record<string, never>>({
            type: "object",
            properties: {},
          }),
          execute: async () => {
            calls += 1;
            if (cancel && calls === 125) controller.abort();
            return "contents";
          },
        }),
      },
      stopWhen: CHAT_STOP_WHEN,
    });
    let aborted = false;
    for await (const part of result.fullStream)
      if (part.type === "abort") aborted = true;
    expect(aborted).toBe(cancel);
    expect(calls).toBe(cancel ? 125 : 175);
    expect(steps).toBe(cancel ? 125 : 176);
    if (!cancel) expect(await result.finishReason).toBe("stop");
  }
);
