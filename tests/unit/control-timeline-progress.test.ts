import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { buildCombinedTimeline } from "../../components/control/build-combined-timeline";

function assistant(parts: unknown[]): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts,
  } as UIMessage;
}

test("control timeline turns resource tools into safe progress steps", () => {
  const events = buildCombinedTimeline(undefined, [
    assistant([
      { type: "step-start" },
      {
        type: "tool-plan_mission",
        toolCallId: "plan-1",
        state: "output-available",
        input: { tasks: [{ title: "Private task details" }] },
        output: { status: "ok" },
      },
      { type: "step-start" },
      {
        type: "tool-sandbox_start",
        toolCallId: "sandbox-1",
        state: "output-available",
        input: {},
        output: {
          ok: true,
          status: "running",
          sandboxId: "sandbox-new",
        },
      },
      { type: "step-start" },
      {
        type: "tool-spawn_worktree",
        toolCallId: "worktree-1",
        state: "input-available",
        input: { taskId: "task-1" },
      },
    ]),
  ]);

  assert.deepEqual(
    events.map(({ kind, label, body }) => ({ kind, label, body })),
    [
      { kind: "progress", label: "STEP 1", body: "Plan saved" },
      { kind: "progress", label: "STEP 2", body: "Sandbox ready" },
      {
        kind: "progress",
        label: "STEP 3",
        body: "Creating worktree",
      },
    ]
  );
  assert.doesNotMatch(JSON.stringify(events), /Private task details/);
});

test("control timeline surfaces structured tool failures as failures", () => {
  const events = buildCombinedTimeline(undefined, [
    assistant([
      { type: "step-start" },
      {
        type: "tool-sandbox_start",
        toolCallId: "sandbox-1",
        state: "output-available",
        input: {},
        output: {
          error: "Provider stopped the sandbox",
          reason: "sandbox_unavailable",
        },
      },
    ]),
  ]);

  assert.deepEqual(events, [
    {
      kind: "fail",
      label: "STEP 1",
      time: "now",
      body: "Sandbox stopped before becoming ready",
      log: "Provider stopped the sandbox",
    },
  ]);
});

test("assistant text is primary conversation content, not a tool event", () => {
  const events = buildCombinedTimeline(undefined, [
    assistant([{ type: "text", text: "I saved the plan." }]),
  ]);

  assert.deepEqual(events, [
    {
      kind: "assistant",
      label: "MOGPLEX",
      time: "now",
      body: "I saved the plan.",
    },
  ]);
});
