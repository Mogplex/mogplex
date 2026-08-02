import assert from "node:assert/strict";
import test from "node:test";
import { createHarnessOutputRenderer } from "../../lib/harness/output-renderer";

test("Claude output renderer ignores init and renders assistant text messages", () => {
  const renderer = createHarnessOutputRenderer("claude-code");

  assert.deepEqual(
    renderer.push(
      "stdout",
      '{"type":"system","subtype":"init","permissionMode":"acceptEdits"}\n'
    ),
    { text: "" }
  );
  assert.deepEqual(
    renderer.push(
      "stdout",
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Implemented the fix."}]}}\n'
    ),
    {
      text: "Implemented the fix.",
      segments: [{ type: "text", text: "Implemented the fix." }],
    }
  );
});

test("Claude output renderer buffers partial json lines and exposes tool calls as structured data", () => {
  const renderer = createHarnessOutputRenderer("claude-code");

  assert.deepEqual(
    renderer.push(
      "stdout",
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"npm test"}}'
    ),
    { text: "" }
  );
  const toolCall = {
    id: "tool-1",
    name: "Bash",
    input: { command: "npm test" },
    output: undefined,
    state: "running" as const,
  };
  assert.deepEqual(renderer.push("stdout", "]}}\n"), {
    text: "",
    toolCalls: [toolCall],
    segments: [{ type: "tool-call", toolCall }],
  });
});

test("Claude output renderer applies tool results to existing tool calls", () => {
  const renderer = createHarnessOutputRenderer("claude-code");

  renderer.push(
    "stdout",
    '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"npm test"}}]}}\n'
  );

  const toolCall = {
    id: "tool-1",
    name: "Bash",
    input: { command: "npm test" },
    output: "All tests passed",
    state: "done" as const,
  };
  assert.deepEqual(
    renderer.push(
      "stdout",
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":"All tests passed"}]}}\n'
    ),
    {
      text: "",
      toolCalls: [toolCall],
      segments: [{ type: "tool-call", toolCall }],
    }
  );
});

test("Claude output renderer falls back to success result when no assistant text was emitted", () => {
  const renderer = createHarnessOutputRenderer("claude-code");

  assert.deepEqual(
    renderer.push(
      "stdout",
      '{"type":"result","subtype":"success","result":"Final answer from result."}\n'
    ),
    {
      text: "Final answer from result.",
      segments: [{ type: "text", text: "Final answer from result." }],
    }
  );
});

test("Claude output renderer preserves raw non-json stderr lines and marks the active tool as denied", () => {
  const renderer = createHarnessOutputRenderer("claude-code");

  renderer.push(
    "stdout",
    '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"git push origin main"}}]}}\n'
  );

  const toolCall = {
    id: "tool-1",
    name: "Bash",
    input: { command: "git push origin main" },
    output: "Permission denied for Bash(git push origin main)",
    state: "denied" as const,
  };
  assert.deepEqual(
    renderer.push(
      "stderr",
      "Permission denied for Bash(git push origin main)\n"
    ),
    {
      text: "\nPermission denied for Bash(git push origin main)",
      toolCalls: [toolCall],
      segments: [
        { type: "tool-call", toolCall },
        {
          type: "text",
          text: "\nPermission denied for Bash(git push origin main)",
        },
      ],
    }
  );
});

test("Claude output renderer interleaves text and tool calls in chronological order", () => {
  const renderer = createHarnessOutputRenderer("claude-code");

  const chunk = renderer.push(
    "stdout",
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Running the suite."},{"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"npm test"}}]}}\n'
  );

  assert.deepEqual(chunk.segments, [
    { type: "text", text: "Running the suite." },
    {
      type: "tool-call",
      toolCall: {
        id: "tool-1",
        name: "Bash",
        input: { command: "npm test" },
        output: undefined,
        state: "running",
      },
    },
  ]);
});

test("Claude output renderer flush surfaces final tool state from non-newline remainder", () => {
  const renderer = createHarnessOutputRenderer("claude-code");

  const chunks = [
    '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"npm test"}}]}}\n',
    '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":"All tests passed"}]}}',
  ];
  for (const chunk of chunks) renderer.push("stdout", chunk);

  const flushed = renderer.flush();
  assert.deepEqual(flushed.toolCalls, [
    {
      id: "tool-1",
      name: "Bash",
      input: { command: "npm test" },
      output: "All tests passed",
      state: "done",
    },
  ]);
});

test("Codex output renderer renders assistant text from json events", () => {
  const renderer = createHarnessOutputRenderer("codex");

  assert.deepEqual(
    renderer.push(
      "stdout",
      '{"type":"item.completed","item":{"id":"msg-1","type":"agent_message","text":"Codex response"}}\n'
    ),
    {
      text: "Codex response",
      segments: [{ type: "text", text: "Codex response" }],
    }
  );
});

test("Codex output renderer exposes command execution events as structured tool calls", () => {
  const renderer = createHarnessOutputRenderer("codex");

  const runningToolCall = {
    id: "cmd-1",
    name: "Command",
    input: { command: "npm test" },
    output: undefined,
    state: "running" as const,
  };
  assert.deepEqual(
    renderer.push(
      "stdout",
      '{"type":"item.started","item":{"id":"cmd-1","type":"command_execution","command":"npm test","aggregated_output":"","exit_code":null,"status":"in_progress"}}\n'
    ),
    {
      text: "",
      toolCalls: [runningToolCall],
      segments: [{ type: "tool-call", toolCall: runningToolCall }],
    }
  );

  const doneToolCall = {
    id: "cmd-1",
    name: "Command",
    input: { command: "npm test" },
    output: { output: "All tests passed", exit_code: 0 },
    state: "done" as const,
  };
  assert.deepEqual(
    renderer.push(
      "stdout",
      '{"type":"item.completed","item":{"id":"cmd-1","type":"command_execution","command":"npm test","aggregated_output":"All tests passed","exit_code":0,"status":"completed"}}\n'
    ),
    {
      text: "",
      toolCalls: [doneToolCall],
      segments: [{ type: "tool-call", toolCall: doneToolCall }],
    }
  );
});

test("Codex output renderer exposes MCP tool calls as structured accordions", () => {
  const renderer = createHarnessOutputRenderer("codex");

  const runningToolCall = {
    id: "mcp-1",
    name: "MCP github/search",
    input: { query: "issues" },
    output: undefined,
    state: "running" as const,
  };
  assert.deepEqual(
    renderer.push(
      "stdout",
      '{"type":"item.started","item":{"id":"mcp-1","type":"mcp_tool_call","server":"github","tool":"search","arguments":{"query":"issues"},"result":null,"error":null,"status":"in_progress"}}\n'
    ),
    {
      text: "",
      toolCalls: [runningToolCall],
      segments: [{ type: "tool-call", toolCall: runningToolCall }],
    }
  );

  const doneToolCall = {
    id: "mcp-1",
    name: "MCP github/search",
    input: { query: "issues" },
    output: { items: 1 },
    state: "done" as const,
  };
  assert.deepEqual(
    renderer.push(
      "stdout",
      '{"type":"item.completed","item":{"id":"mcp-1","type":"mcp_tool_call","server":"github","tool":"search","arguments":{"query":"issues"},"result":{"content":[{"title":"Issue 1"}],"structured_content":{"items":1}},"error":null,"status":"completed"}}\n'
    ),
    {
      text: "",
      toolCalls: [doneToolCall],
      segments: [{ type: "tool-call", toolCall: doneToolCall }],
    }
  );
});

test("Codex output renderer preserves non-json status lines as readable text", () => {
  const renderer = createHarnessOutputRenderer("codex");

  assert.deepEqual(renderer.push("stderr", "codex warning line\n"), {
    text: "codex warning line",
    segments: [{ type: "text", text: "codex warning line" }],
  });
  assert.deepEqual(renderer.flush(), { text: "" });
});
