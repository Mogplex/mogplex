import assert from "node:assert/strict";
import test from "node:test";
import { readExternalHarnessProgress } from "../../lib/mogplex-api/harness-progress";
import { buildRunRow } from "./helpers/mogplex-api-runs-fixtures";

function harnessResponse(events: unknown[]): Response {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
  );
}

test("external harness progress persists assistant deltas and tool transitions", async () => {
  const appended: Array<Record<string, unknown>> = [];
  const response = harnessResponse([
    {
      type: "log",
      stream: "stdout",
      data: `${JSON.stringify({
        type: "item.completed",
        item: { id: "message-1", type: "agent_message", text: "Working" },
      })}\n`,
    },
    {
      type: "log",
      stream: "stdout",
      data: `${JSON.stringify({
        type: "item.started",
        item: {
          id: "command-1",
          type: "command_execution",
          command: "pnpm test",
          status: "in_progress",
        },
      })}\n`,
    },
    {
      type: "log",
      stream: "stdout",
      data: `${JSON.stringify({
        type: "item.completed",
        item: {
          id: "command-1",
          type: "command_execution",
          command: "pnpm test",
          aggregated_output: "ok",
          exit_code: 0,
          status: "completed",
        },
      })}\n`,
    },
    { type: "done", exitCode: 0 },
  ]);

  await readExternalHarnessProgress({
    response,
    run: buildRunRow({ harness: "codex" }),
    appendEvent: async (event) => {
      appended.push(event);
      return null;
    },
  });

  assert.deepEqual(
    appended.map((event) => ({
      type: event.eventType,
      toolName: event.toolName,
      message: event.message,
      payload: event.payload,
    })),
    [
      {
        type: "log",
        toolName: undefined,
        message: "Working",
        payload: { kind: "assistant_delta" },
      },
      {
        type: "tool_started",
        toolName: "Command",
        message: "Command started",
        payload: { kind: "tool", toolCallId: "command-1", state: "running" },
      },
      {
        type: "tool_finished",
        toolName: "Command",
        message: "Command finished",
        payload: { kind: "tool", toolCallId: "command-1", state: "done" },
      },
    ]
  );
});

test("external harness progress returns the aggregated output and session id", async () => {
  const response = harnessResponse([
    {
      type: "log",
      stream: "stdout",
      data: `${JSON.stringify({
        type: "item.completed",
        item: { id: "message-1", type: "agent_message", text: "Done" },
      })}\n`,
    },
    { type: "session", sessionId: "sess-xyz" },
    { type: "done", exitCode: 0 },
  ]);

  const result = await readExternalHarnessProgress({
    response,
    run: buildRunRow({ harness: "codex" }),
    appendEvent: async () => null,
  });

  assert.equal(result.sessionId, "sess-xyz");
  assert.match(result.output, /Done/);
});

test("external harness progress rejects harness error events", async () => {
  await assert.rejects(
    readExternalHarnessProgress({
      response: harnessResponse([{ type: "error", data: "sandbox failed" }]),
      run: buildRunRow(),
      appendEvent: async () => null,
    }),
    /sandbox failed/
  );
});
