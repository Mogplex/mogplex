import { convertToModelMessages } from "ai";
import { expect, it } from "vitest";
import {
  normalizeControlChatMessages,
  validateControlChatMessages,
} from "@/app/api/control/chat/_lib/messages";

it("retains command results and stable message identity across a Control follow-up", async () => {
  const messages = normalizeControlChatMessages([
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Check the worker" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool-list_worktrees",
          toolCallId: "lookup",
          state: "output-available",
          input: {},
          output: {
            worktrees: [
              { worker: { status: "failed", error: "Authentication failed" } },
            ],
          },
        },
      ],
    },
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "Why did it stop?" }],
    },
  ] as Parameters<typeof normalizeControlChatMessages>[0]);
  expect(messages.map((message) => (message as { id?: string }).id)).toEqual([
    "user-1",
    "assistant-1",
    "user-2",
  ]);
  const modelMessages = await convertToModelMessages(messages);
  expect(modelMessages).toContainEqual(
    expect.objectContaining({
      role: "tool",
      content: [
        expect.objectContaining({
          type: "tool-result",
          toolCallId: "lookup",
          output: expect.objectContaining({
            value: {
              worktrees: [
                {
                  worker: { status: "failed", error: "Authentication failed" },
                },
              ],
            },
          }),
        }),
      ],
    })
  );
});

it("validates native tool errors and approval responses without dropping their evidence", async () => {
  const messages = await validateControlChatMessages([
    {
      id: "a",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "run_command",
          toolCallId: "failed",
          state: "output-error",
          input: { command: "pwd" },
          errorText: "Sandbox unavailable",
        },
        {
          type: "tool-git_push",
          toolCallId: "approved",
          state: "approval-responded",
          input: { branch: "feature" },
          approval: { id: "approval", approved: false },
        },
      ],
    },
  ]);
  expect(messages[0].parts).toHaveLength(2);
  expect(JSON.stringify(await convertToModelMessages(messages))).toContain(
    "Sandbox unavailable"
  );
  expect(JSON.stringify(await convertToModelMessages(messages))).toContain(
    "approval"
  );
});

it("rejects malformed tools, duplicate ids, and tools hidden in user messages before execution", async () => {
  await expect(
    validateControlChatMessages([
      {
        id: "a",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "run_command",
            state: "output-error",
          } as never,
        ],
      },
    ])
  ).rejects.toThrow("Invalid Control chat history");
  await expect(
    validateControlChatMessages([
      { id: "a", role: "user", parts: [] },
      { id: "a", role: "assistant", parts: [] },
    ])
  ).rejects.toThrow("message id");
  await expect(
    validateControlChatMessages([
      {
        role: "user",
        parts: [
          {
            type: "tool-run_command",
            toolCallId: "x",
            state: "output-available",
            input: {},
            output: {},
          },
        ],
      },
    ])
  ).rejects.toThrow("assistant message");
  expect(
    (
      await validateControlChatMessages([{ role: "user", content: "legacy" }])
    )[0].id
  ).toBe("control-legacy-0");
});
