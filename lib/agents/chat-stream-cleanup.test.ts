import { expect, it } from "vitest";
import { streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { withChatStreamCleanup } from "./chat-stream-cleanup";

it("releases tool resources on a real SDK provider error with no finished step", async () => {
  let released = false;
  let errorReceived: unknown;
  const failure = new Error("provider unavailable");
  const hooks = withChatStreamCleanup(
    {
      onError: ({ error }) => {
        errorReceived = error;
      },
    },
    async () => {
      released = true;
    }
  );
  const model = new MockLanguageModelV3({
    doStream: async () => {
      throw failure;
    },
  });
  await streamText({ model, prompt: "hello", maxRetries: 0, ...hooks })
    .toUIMessageStreamResponse()
    .text();
  expect(errorReceived).toBe(failure);
  expect(released).toBe(true);
});

it("releases resources even if the caller's error finalization fails", async () => {
  let released = false;
  const failure = new Error("database unavailable");
  const hooks = withChatStreamCleanup(
    {
      onError: () => {
        throw failure;
      },
    },
    async () => {
      released = true;
    }
  );
  await expect(
    hooks.onError!({ error: new Error("provider unavailable") })
  ).rejects.toBe(failure);
  expect(released).toBe(true);
});

it("cleans up an aborted stream even without caller hooks", async () => {
  let released = false;
  const hooks = withChatStreamCleanup(undefined, async () => {
    released = true;
  });
  await hooks.onAbort!({ steps: [] });
  expect(released).toBe(true);
});

it("forwards successful completion before releasing tools", async () => {
  const order: string[] = [];
  const hooks = withChatStreamCleanup(
    {
      onFinish: () => {
        order.push("finished");
      },
    },
    async () => {
      order.push("released");
    }
  );
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "answer" });
          controller.enqueue({
            type: "text-delta",
            id: "answer",
            delta: "done",
          });
          controller.enqueue({ type: "text-end", id: "answer" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: {
                total: 2,
                noCache: 2,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          });
          controller.close();
        },
      }),
    }),
  });
  const body = await streamText({ model, prompt: "hello", ...hooks })
    .toUIMessageStreamResponse()
    .text();
  expect(body).toContain("done");
  expect(order).toEqual(["finished", "released"]);
});
