import assert from "node:assert/strict";
import test from "node:test";
import {
  readTerminalExecImmediateResponse,
  TERMINAL_EXEC_MODE_HEADER,
  TERMINAL_EXEC_MODE_IMMEDIATE,
} from "../../lib/sandbox/terminal-exec-response";

test("readTerminalExecImmediateResponse ignores SSE responses", async () => {
  const response = new Response("data: {}\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });

  assert.equal(await readTerminalExecImmediateResponse(response), null);
});

test("readTerminalExecImmediateResponse parses JSON exec payloads", async () => {
  const response = new Response(
    JSON.stringify({
      exitCode: 1,
      stdout: "",
      stderr: "Codex interactive mode needs a TTY",
      cwd: "/workspace",
    }),
    {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }
  );

  assert.deepEqual(await readTerminalExecImmediateResponse(response), {
    exitCode: 1,
    stdout: "",
    stderr: "Codex interactive mode needs a TTY",
    cwd: "/workspace",
    error: undefined,
  });
});

test("readTerminalExecImmediateResponse parses explicitly tagged immediate payloads", async () => {
  const response = new Response(
    JSON.stringify({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    }),
    {
      headers: {
        [TERMINAL_EXEC_MODE_HEADER]: TERMINAL_EXEC_MODE_IMMEDIATE,
      },
      status: 200,
    }
  );

  assert.deepEqual(await readTerminalExecImmediateResponse(response), {
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    cwd: undefined,
    error: undefined,
  });
});

test("readTerminalExecImmediateResponse ignores successful non-immediate plain responses", async () => {
  const response = new Response("", {
    headers: { "Content-Type": "text/plain" },
    status: 200,
  });

  assert.equal(await readTerminalExecImmediateResponse(response), null);
});

test("readTerminalExecImmediateResponse falls back to plain-text HTTP errors", async () => {
  const response = new Response("gateway down", {
    headers: { "Content-Type": "text/plain" },
    status: 502,
  });

  assert.deepEqual(await readTerminalExecImmediateResponse(response), {
    exitCode: null,
    stdout: "",
    stderr: "",
    cwd: undefined,
    error: "gateway down",
  });
});
