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

test("control timeline distinguishes ordinary starts and recovered cleanup", () => {
  const events = buildCombinedTimeline(undefined, [
    assistant([
      { type: "step-start" },
      {
        type: "tool-sandbox_start",
        toolCallId: "sandbox-pending",
        state: "input-available",
        input: {},
      },
      { type: "step-start" },
      {
        type: "tool-sandbox_start",
        toolCallId: "sandbox-recovered",
        state: "output-available",
        input: {},
        output: {
          ok: true,
          status: "running",
          recoveredFromCleanup: true,
          cleanupWaitMs: 2_500,
        },
      },
    ]),
  ]);

  assert.deepEqual(
    events.map(({ kind, body }) => ({ kind, body })),
    [
      {
        kind: "progress",
        body: "Starting sandbox",
      },
      {
        kind: "progress",
        body: "Sandbox recovered and ready · cleanup 3s",
      },
    ]
  );
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
      body: "Sandbox startup failed.",
      log: "Provider stopped the sandbox",
    },
  ]);
});

test("control timeline presents recoverable sandbox selection outcomes", () => {
  for (const reason of ["multiple_sandboxes", "repo_mismatch"]) {
    const events = buildCombinedTimeline(undefined, [
      assistant([
        { type: "step-start" },
        {
          type: "tool-sandbox_start",
          toolCallId: `sandbox-${reason}`,
          state: "output-available",
          input: {},
          output: { error: "Selection required", reason },
        },
      ]),
    ]);

    assert.deepEqual(events, [
      {
        kind: "fail",
        label: "STEP 1",
        time: "now",
        body: "Sandbox selection needed",
        log: "Selection required",
      },
    ]);
  }
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

test("assistant text and tool errors hide infrastructure by default", () => {
  const messages = [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Ship the fix" }],
    },
    assistant([
      {
        type: "text",
        text: "Vercel Sandbox failed at /Users/me/repo/.worktrees/sbx_abcdef/src/app.ts for deployment dpl_123456.",
      },
      {
        type: "tool-run_command",
        toolCallId: "run-1",
        state: "output-error",
        input: {},
        errorText: "at /Users/me/repo/src/app.ts with sbx_abcdef",
      },
    ]),
  ] as UIMessage[];

  const events = buildCombinedTimeline(undefined, messages);
  const serialized = JSON.stringify(events);

  assert.match(serialized, /development environment/);
  assert.match(serialized, /src\/app\.ts/);
  assert.doesNotMatch(
    serialized,
    /Vercel Sandbox|\/Users\/me|dpl_123456|sbx_abcdef/
  );
});

test("assistant text preserves only requested diagnostics while redacting secrets", () => {
  const messages = [
    {
      id: "user-1",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Show the sandbox provider and absolute filesystem path for diagnostics",
        },
      ],
    },
    assistant([
      {
        type: "text",
        text: "Vercel Sandbox sbx_unrelated123 at /Users/me/repo with token sk-secretvalue",
      },
    ]),
  ] as UIMessage[];

  const events = buildCombinedTimeline(undefined, messages);
  const serialized = JSON.stringify(events);

  assert.match(serialized, /Vercel Sandbox/);
  assert.match(serialized, /\/Users\/me\/repo/);
  assert.doesNotMatch(serialized, /sbx_unrelated123/);
  assert.doesNotMatch(serialized, /sk-secretvalue/);
  assert.match(serialized, /\[redacted\]/);
});

test("tool details expose argument names without raw values", () => {
  const events = buildCombinedTimeline(undefined, [
    assistant([
      {
        type: "tool-write_file",
        toolCallId: "write-1",
        state: "input-available",
        input: {
          path: "private/path.ts",
          content: "private file contents",
        },
      },
    ]),
  ]);

  assert.deepEqual(events, [
    {
      kind: "tool",
      label: "TOOL",
      time: "now",
      body: "Using write_file",
      details: "write_file(path, content)",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /private/);
});
