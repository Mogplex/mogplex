import { expect, it } from "vitest";
import type { UIMessage } from "ai";
import { currentTurnMessages, presentTurnProgress } from "./turn-progress";

const history: UIMessage[] = [
  { id: "old", role: "user", parts: [{ type: "text", text: "Old request" }] },
  {
    id: "old-answer",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "run_command",
        toolCallId: "old-call",
        state: "input-available",
        input: { command: "old command" },
      },
    ],
  },
  { id: "new", role: "user", parts: [{ type: "text", text: "Fix the tests" }] },
];
it("starts a follow-up with its own progress instead of an old unfinished tool", () => {
  expect(currentTurnMessages(history).map((message) => message.id)).toEqual([
    "new",
  ]);
  expect(presentTurnProgress(history, "submitted")).toMatchObject({
    label: "Starting your request",
    completed: 0,
  });
});
it("shows actual tool state and returns to thinking after command completion", () => {
  const messages: UIMessage[] = [
    ...history,
    {
      id: "answer",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "run_command",
          toolCallId: "call",
          state: "input-available",
          input: { command: "pnpm test" },
        },
      ],
    },
  ];
  expect(presentTurnProgress(messages, "streaming")).toMatchObject({
    label: "Running command",
    detail: "pnpm test",
    completed: 0,
  });
  messages[3].parts = [
    {
      type: "dynamic-tool",
      toolName: "run_command",
      toolCallId: "call",
      state: "output-available",
      input: { command: "pnpm test" },
      output: { exitCode: 1 },
    },
  ];
  expect(presentTurnProgress(messages, "streaming")).toMatchObject({
    label: "Thinking",
    completed: 1,
    failed: 1,
  });
  expect(presentTurnProgress(messages, "ready")).toBeNull();
});
it("makes required approval explicit", () => {
  const messages: UIMessage[] = [
    ...history,
    {
      id: "approval",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "run_command",
          toolCallId: "call",
          state: "approval-requested",
          input: {},
          approval: { id: "a" },
        },
      ],
    },
  ];
  expect(presentTurnProgress(messages, "ready")).toMatchObject({
    label: "Waiting for your approval",
  });
});

it("distinguishes a streamed reply from waiting for the next model step", () => {
  const messages: UIMessage[] = [
    ...history,
    {
      id: "reply",
      role: "assistant",
      parts: [
        { type: "text", text: "Checking the test failure", state: "streaming" },
      ],
    },
  ];
  expect(presentTurnProgress(messages, "streaming")?.label).toBe(
    "Writing response"
  );
  expect(presentTurnProgress(messages, "error")).toBeNull();
  expect(presentTurnProgress([], "ready")).toBeNull();
  expect(currentTurnMessages(messages.slice(3))).toEqual(messages.slice(3));
});

it("redacts sensitive command details and never turns arbitrary tool arguments into UI copy", async () => {
  const { toolActivityDetail, toolActivityLabel } =
    await import("./turn-progress");
  expect(
    toolActivityDetail({
      command: "echo sk-secretvalue",
      env: { SECRET: "hidden-value" },
    })
  ).not.toMatch(/sk-secretvalue|hidden-value/);
  expect(toolActivityDetail({ content: "private source" })).toBeNull();
  expect(toolActivityDetail(null)).toBeNull();
  expect(toolActivityDetail("private source")).toBeNull();
  expect(toolActivityDetail({ filePath: "src/index.ts" })).toBe("src/index.ts");
  expect(toolActivityDetail({ query: "find tests" })).toBe("find tests");
  expect(toolActivityLabel("inspect_repository")).toBe("inspect repository");
});
