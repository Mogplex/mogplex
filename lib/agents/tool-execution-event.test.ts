import { generateText, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { expect, it } from "vitest";
import { z } from "zod";
import { toolCompletionEvent } from "./tool-execution-event";
import { captureUsage } from "@/lib/observability/usage";

it("records successful and failed SDK 7 tools and counts usage across steps", async () => {
  const usage = {
    inputTokens: { total: 10, noCache: 5, cacheRead: 3, cacheWrite: 2 },
    outputTokens: { total: 4, text: 3, reasoning: 1 },
  };
  const failure = new Error("Command failed");
  const model = new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "ok-1",
            toolName: "ok",
            input: "{}",
          },
          {
            type: "tool-call",
            toolCallId: "bad-1",
            toolName: "bad",
            input: "{}",
          },
        ],
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "One command failed." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      },
    ],
  });
  const events: ReturnType<typeof toolCompletionEvent>[] = [];
  const result = await generateText({
    model,
    prompt: "Run both commands and report the results.",
    stopWhen: () => false,
    tools: {
      ok: tool({
        inputSchema: z.object({}),
        execute: async () => ({ exitCode: 0 }),
      }),
      bad: tool({
        inputSchema: z.object({}),
        execute: async (): Promise<string> => {
          throw failure;
        },
      }),
    },
    onToolExecutionEnd: (event) => {
      events.push(toolCompletionEvent(event));
    },
  });
  expect(result.text).toBe("One command failed.");
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        toolCall: expect.objectContaining({ toolCallId: "ok-1" }),
        success: true,
        output: { exitCode: 0 },
        error: undefined,
        durationMs: expect.any(Number),
      }),
      expect.objectContaining({
        toolCall: expect.objectContaining({ toolCallId: "bad-1" }),
        success: false,
        output: undefined,
        error: failure,
        durationMs: expect.any(Number),
      }),
    ])
  );
  expect(events).toHaveLength(2);
  expect(captureUsage(result.usage, undefined)).toMatchObject({
    inputTokens: 20,
    outputTokens: 8,
    cacheReadInputTokens: 6,
    cacheCreationInputTokens: 4,
    reasoningTokens: 2,
  });
});
