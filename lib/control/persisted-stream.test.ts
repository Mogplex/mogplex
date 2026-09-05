import type { UIMessage, UIMessageChunk } from "ai";
import { expect, it } from "vitest";
import { persistedControlStream } from "./persisted-stream";
import type { ControlSessionRecord } from "./session-types";

const record = (messages: UIMessage[]): ControlSessionRecord => ({
  id: "session",
  title: "Mission",
  project: null,
  repo_id: null,
  model_id: null,
  orchestration_run_id: null,
  pinned: false,
  updated_at: "revision",
  messages,
});

it("checkpoints command evidence while running and saves completion after the browser disconnects", async () => {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>;
  let checkpointed!: () => void;
  const firstCheckpoint = new Promise<void>((resolve) => {
    checkpointed = resolve;
  });
  const writes: Array<{ messages: UIMessage[]; previous: UIMessage[] }> = [];
  const source = new ReadableStream<UIMessageChunk>({
    start(c) {
      controller = c;
    },
  });
  const unrelated: UIMessage = {
    id: "other-response",
    role: "assistant",
    parts: [{ type: "text", text: "Other tab reply" }],
  };
  const durable = await persistedControlStream({
    stream: source,
    messages: [unrelated],
    expectedMessages: [unrelated],
    messageId: "this-response",
    save: async (messages, previous) => {
      if (messages[0].parts.length > 0) {
        writes.push(structuredClone({ messages, previous }));
        checkpointed();
      }
      return record([unrelated, ...messages]);
    },
    onError: () => "Save failed",
  });
  controller.enqueue({ type: "start" });
  controller.enqueue({ type: "start-step" });
  controller.enqueue({
    type: "tool-input-available",
    toolCallId: "command",
    toolName: "run_command",
    input: { command: "pnpm test" },
  });
  controller.enqueue({
    type: "tool-output-available",
    toolCallId: "command",
    output: { exitCode: 1, stdout: "One test failed" },
  });
  controller.enqueue({ type: "finish-step" });
  await firstCheckpoint;
  expect(writes[0].messages[0]).toMatchObject({
    id: "this-response",
    parts: [
      expect.anything(),
      expect.objectContaining({
        output: { exitCode: 1, stdout: "One test failed" },
      }),
    ],
  });
  const leaving = durable.stream.cancel();
  controller.enqueue({ type: "text-start", id: "text" });
  controller.enqueue({
    type: "text-delta",
    id: "text",
    delta: "Here is the failure.",
  });
  controller.enqueue({ type: "text-end", id: "text" });
  controller.enqueue({ type: "finish", finishReason: "stop" });
  controller.close();
  await durable.completion;
  await leaving;
  expect(writes).toHaveLength(2);
  expect(writes[1].previous).toEqual(writes[0].messages);
  expect(writes[1].messages[0].id).toBe("this-response");
  expect(JSON.stringify(writes[1].messages)).toContain("Here is the failure.");
  expect(JSON.stringify(writes[1].messages)).not.toContain("Other tab reply");
});

it("retains partial output on abort and never claims a failed save completed", async () => {
  const source = () =>
    new ReadableStream<UIMessageChunk>({
      start(c) {
        c.enqueue({ type: "start" });
        c.enqueue({ type: "text-start", id: "t" });
        c.enqueue({
          type: "text-delta",
          id: "t",
          delta: "Work reached this point",
        });
        c.enqueue({ type: "abort" });
        c.close();
      },
    });
  let saved: UIMessage[] = [];
  const durable = await persistedControlStream({
    stream: source(),
    messages: [],
    expectedMessages: [],
    messageId: "partial",
    save: async (messages) => {
      saved = messages;
      return record(messages);
    },
    onError: () => "Save failed",
  });
  await durable.completion;
  expect(saved[0]).toMatchObject({
    id: "partial",
    parts: [{ type: "text", text: "Work reached this point" }],
  });
  await expect(
    persistedControlStream({
      stream: source(),
      messages: [],
      expectedMessages: [],
      messageId: "failed",
      save: async () => {
        throw new Error("Database unavailable");
      },
      onError: () => "Save failed",
    })
  ).rejects.toThrow("Database unavailable");
});

it("reserves a response before publishing its stream so a browser cannot win the first checkpoint race", async () => {
  const stored: UIMessage[] = [];
  const durable = await persistedControlStream({
    stream: new ReadableStream({
      start(c) {
        c.close();
      },
    }),
    messages: [],
    expectedMessages: [],
    messageId: "reserved",
    save: async (messages) => {
      stored.push(...messages);
      return record(stored);
    },
    onError: () => "Save failed",
  });
  expect(stored).toEqual([{ id: "reserved", role: "assistant", parts: [] }]);
  await durable.completion;
});

it("updates only the explicitly approved message and preserves its original evidence", async () => {
  const pending: UIMessage = {
    id: "approval-message",
    role: "assistant",
    parts: [
      {
        type: "tool-git_push",
        toolCallId: "push",
        state: "approval-responded",
        input: { branch: "feature" },
        approval: { id: "approve-push", approved: true },
      },
    ],
  };
  let saved: UIMessage[] = [];
  const durable = await persistedControlStream({
    stream: new ReadableStream({
      start(c) {
        c.enqueue({ type: "start" });
        c.enqueue({
          type: "tool-output-available",
          toolCallId: "push",
          output: { branch: "feature", pushed: true },
        });
        c.enqueue({ type: "finish", finishReason: "stop" });
        c.close();
      },
    }),
    messages: [pending],
    expectedMessages: [pending],
    messageId: "unused-new-id",
    continuationMessageId: pending.id,
    save: async (messages, expected) => {
      expect(expected).toEqual([pending]);
      saved = messages;
      return record(saved);
    },
    onError: () => "Save failed",
  });
  await durable.completion;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    id: pending.id,
    parts: [
      {
        state: "output-available",
        input: { branch: "feature" },
        output: { pushed: true },
      },
    ],
  });
});

it("rejects completion when the final checkpoint fails after a successful reservation", async () => {
  let released = false;
  const durable = await persistedControlStream({
    stream: new ReadableStream({
      start(c) {
        c.enqueue({ type: "start" });
        c.enqueue({ type: "text-start", id: "text" });
        c.enqueue({ type: "text-delta", id: "text", delta: "Must be saved" });
        c.enqueue({ type: "text-end", id: "text" });
        c.enqueue({ type: "finish", finishReason: "stop" });
        c.close();
      },
    }),
    messages: [],
    expectedMessages: [],
    messageId: "failed-save",
    onComplete: async () => {
      released = true;
    },
    save: async (messages) => {
      if (messages[0].parts.length > 0)
        throw new Error("Checkpoint unavailable");
      return record(messages);
    },
    onError: () => "Save failed",
  });
  await expect(durable.completion).rejects.toThrow("Checkpoint unavailable");
  expect(released).toBe(false);
});
