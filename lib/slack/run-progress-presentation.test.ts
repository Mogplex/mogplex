import { expect, it } from "vitest";
import {
  buildRunProgressMessage,
  runProgressTitle,
} from "./run-progress-presentation";
import { applyRunProgress, createRunProgressState } from "./run-progress-state";
import type { RunGuidance } from "./run-guidance-store";
import { guidanceReceiptText } from "./run-guidance-presentation";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";
const run = {
  id: "run-1",
  status: "streaming",
  prompt: "Fix the header\nKeep desktop unchanged",
  working_branch: "fix/header",
  metadata: { slack_guidance_enabled: true },
};
const receipt = (status: RunGuidance["status"], body: string): RunGuidance => ({
  id: "guidance-1",
  run_id: run.id,
  user_id: "owner",
  ai_call_id: "call-1",
  status,
  body,
  delivered_step: status === "delivered" ? 2 : null,
  attachments: null,
  created_at: new Date(0).toISOString(),
});

it("renders native task identities, statuses and outputs, not just fallback text", () => {
  const state = createRunProgressState(0);
  for (let index = 0; index < 5; index++) {
    const toolCallId = `task-${index}`;
    applyRunProgress(
      state,
      {
        kind: "tool_started",
        toolCallId,
        toolName: "bash",
        input: { command: "pnpm test" },
      },
      1000 + index
    );
    applyRunProgress(
      state,
      {
        kind: "tool_finished",
        toolCallId,
        toolName: "bash",
        state: "success",
        output: { exitCode: index === 4 ? 1 : 0 },
      },
      2000 + index
    );
  }
  applyRunProgress(
    state,
    { kind: "tool_started", toolCallId: "current", toolName: "read_file" },
    5000
  );
  const message = buildRunProgressMessage(run, state);
  expect(message.blocks.find((block) => block.type === "plan")).toEqual({
    type: "plan",
    title: "Recent work",
    tasks: [
      ...[2, 3, 4].map((index) => ({
        task_id: `task-${index}`,
        title: "Running tests",
        status: index === 4 ? "error" : "complete",
        output: {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                {
                  type: "text",
                  text:
                    index === 4
                      ? "Command exited with code 1"
                      : "Command completed with exit code 0",
                },
              ],
            },
          ],
        },
      })),
      { task_id: "current", title: "Reading a file", status: "in_progress" },
    ],
  });
  expect(message.text).toContain("Current step: Reading a file");
  expect(message.text).not.toContain("In progress: Running tests");
  expect(message.text).toContain("Needs attention: Running tests");
  expect(
    message.blocks.find(
      (block) =>
        block.type === "context" &&
        JSON.stringify(block).includes("Last activity")
    )
  ).toEqual({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Last activity <!date^5^{time_secs}|1970-01-01T00:00:05.000Z> · <${process.env.NEXT_PUBLIC_APP_URL}/runs/run-1|View run details>`,
      },
      { type: "plain_text", text: "Branch: fix/header" },
    ],
  });
});

it("keeps run navigation, neutral cancellation and the guidance receipt visible in blocks", () => {
  const state = createRunProgressState(0);
  const message = buildRunProgressMessage(run, state, [
    receipt("received", "Keep desktop unchanged"),
  ]);
  expect(message.blocks).toContainEqual({
    type: "section",
    text: {
      type: "plain_text",
      text: "Your guidance\nSaved for the next agent step: Keep desktop unchanged",
    },
  });
  expect(message.blocks).toContainEqual({
    type: "context",
    elements: [
      {
        type: "plain_text",
        text: "Reply in this thread to guide the next step. The current command may need to finish first.",
      },
    ],
  });
  const actions = message.blocks.find((block) => block.type === "actions");
  expect(actions).toMatchObject({
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "View work" },
        url: `${process.env.NEXT_PUBLIC_APP_URL}/runs/run-1`,
        action_id: "mogplex-view-run",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Cancel run" },
        action_id: "mogplex-cancel-run",
        value: run.id,
      },
    ],
  });
  expect(JSON.stringify(actions)).not.toContain('"style":"danger"');
  const paused = buildRunProgressMessage(
    { ...run, status: "awaiting_input" },
    state
  );
  expect(paused.blocks.find((block) => block.type === "actions")).toMatchObject(
    {
      elements: [
        {
          action_id: "mogplex-view-run",
          url: `${process.env.NEXT_PUBLIC_APP_URL}/runs/run-1`,
        },
      ],
    }
  );
  expect(JSON.stringify(paused.blocks)).not.toContain("guide the next step");
  expect(JSON.stringify(paused.blocks)).not.toContain("mogplex-cancel-run");
  expect(
    JSON.stringify(
      buildRunProgressMessage({ ...run, metadata: {} }, state).blocks
    )
  ).not.toContain("guide the next step");
});

it("uses a safe task title and distinguishes multiple active operations", () => {
  expect(runProgressTitle(run)).toBe("Fix the header");
  expect(
    runProgressTitle({ ...run, metadata: { slack_task_title: "Chosen task" } })
  ).toBe("Chosen task");
  expect(runProgressTitle({ id: run.id, metadata: null })).toBe(
    "Repository task"
  );
  const state = createRunProgressState(0);
  for (const toolCallId of ["a", "b"])
    applyRunProgress(
      state,
      { kind: "tool_started", toolCallId, toolName: "read_file" },
      1000
    );
  const message = buildRunProgressMessage(run, state);
  expect(message.text).toContain(
    "2 active steps: Reading a file; Reading a file"
  );
  expect(JSON.stringify(message.blocks)).toContain(
    "2 active steps: Reading a file; Reading a file"
  );
});

it("shows only recent guidance with accurate receipts, safe text and an image fallback", () => {
  expect(
    guidanceReceiptText([
      receipt("received", "Older guidance"),
      receipt("received", "Keep <!channel> desktop unchanged"),
      receipt("delivered", ""),
      receipt("not_applied", "Review before merging"),
    ])
  ).toBe(
    "Saved for the next agent step: Keep desktop unchanged\nSupplied to agent step 3: Image guidance\nDelivery not confirmed before the run stopped: Review before merging"
  );
  expect(guidanceReceiptText([])).toBe("");
  expect(guidanceReceiptText([receipt("received", "x".repeat(200))])).toBe(
    `Saved for the next agent step: ${"x".repeat(179)}…`
  );
});
