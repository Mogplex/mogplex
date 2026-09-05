import { describe, expect, it } from "vitest";
import type { UIMessage, UIMessageChunk } from "ai";
import {
  CHAT_TOOL_INTERRUPTED_MESSAGE,
  CHAT_INTERRUPTED_MESSAGE,
  markInterruptedChatResponse,
  WorkspaceChatTransport,
} from "./chat-stream";

async function readChunks(chunks: UIMessageChunk[], suffix = "") {
  let requests = 0;
  const transport = new WorkspaceChatTransport({
    fetch: async () => {
      requests += 1;
      return new Response(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
          suffix
      );
    },
  });
  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId: "chat",
    messageId: undefined,
    messages: [],
    abortSignal: undefined,
  });
  const reader = stream.getReader();
  const result: UIMessageChunk[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      result.push(value);
    }
    return { result, requests };
  } finally {
    reader.releaseLock();
  }
}

describe("workspace chat stream completion", () => {
  it.each([
    { chunks: [] },
    { chunks: [{ type: "start" }] },
    { chunks: [{ type: "finish-step" }] },
  ] satisfies { chunks: UIMessageChunk[] }[])(
    "rejects EOF without a terminal event (%j)",
    async ({ chunks }) => {
      await expect(readChunks(chunks)).rejects.toThrow(
        CHAT_INTERRUPTED_MESSAGE
      );
    }
  );
  it("does not mistake an SSE DONE sentinel for the final model result", async () => {
    await expect(readChunks([], "data: [DONE]\n\n")).rejects.toThrow(
      CHAT_INTERRUPTED_MESSAGE
    );
  });
  it.each(["finish", "error"] as const)(
    "accepts explicit %s without replay",
    async (type) => {
      const chunk: UIMessageChunk =
        type === "error" ? { type, errorText: "Unavailable" } : { type };
      expect(await readChunks([chunk], "data: [DONE]\n\n")).toEqual({
        result: [chunk],
        requests: 1,
      });
    }
  );
  it.each([
    { type: "abort" },
    { type: "finish", finishReason: "error" },
  ] satisfies UIMessageChunk[])(
    "surfaces terminal failure %j",
    async (chunk) => {
      expect(await readChunks([chunk])).toEqual({
        result: [{ type: "error", errorText: CHAT_INTERRUPTED_MESSAGE }],
        requests: 1,
      });
    }
  );
  it("retains SDK validation for malformed frames", async () => {
    await expect(
      readChunks([], 'data: {"type":"not-a-chunk"}\n\n')
    ).rejects.toThrow();
  });
});

it("marks only unfinished tools in the interrupted response, preserving completed tools and prior history", () => {
  const parts: UIMessage["parts"] = [
    { type: "text", text: "Partial response", state: "streaming" },
    {
      type: "tool-bash",
      toolCallId: "in-flight",
      state: "input-available",
      input: { command: "check" },
    },
    {
      type: "dynamic-tool",
      toolName: "other",
      toolCallId: "partial-input",
      state: "input-streaming",
      input: undefined,
    },
    {
      type: "tool-bash",
      toolCallId: "done",
      state: "output-available",
      input: {},
      output: "finished",
    },
  ];
  const messages: UIMessage[] = [
    { id: "old", role: "assistant", parts },
    { id: "current", role: "assistant", parts },
  ];
  const result = markInterruptedChatResponse(messages, "current");
  expect(result[0]).toBe(messages[0]);
  expect(result[1].parts[0]).toMatchObject({
    text: "Partial response",
    state: "done",
  });
  expect(result[1].parts[1]).toMatchObject({
    state: "output-error",
    errorText: CHAT_TOOL_INTERRUPTED_MESSAGE,
  });
  expect(result[1].parts[2]).toMatchObject({
    state: "output-error",
    errorText: CHAT_TOOL_INTERRUPTED_MESSAGE,
  });
  expect(result[1].parts[3]).toBe(parts[3]);
  expect(messages[1].parts[1]).toMatchObject({ state: "input-available" });
});
