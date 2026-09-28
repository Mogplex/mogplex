import { describe, expect, it } from "vitest";
import { createHarnessOutputRenderer } from "@/lib/harness/output-renderer";
import { createHarnessSessionParser } from "@/lib/harness/session-parser";

const line = (event: Record<string, unknown>) =>
  `${JSON.stringify({ mogplex_acp: 1, ...event })}\n`;
const update = (body: Record<string, unknown>) =>
  line({ type: "update", update: body });

// Shapes recorded from @agentclientprotocol/codex-acp 2.0.0 through the
// bridge, with the checkout path replaced.
const REAL_TURN = [
  line({ type: "start" }),
  line({
    type: "initialize",
    agentInfo: { name: "@agentclientprotocol/codex-acp", version: "2.0.0" },
  }),
  line({ type: "session", sessionId: "01a0ea14-f930-74f0-8bbc-f322cdfb36b6" }),
  update({ sessionUpdate: "available_commands_update", availableCommands: [] }),
  update({
    sessionUpdate: "agent_message_chunk",
    messageId: "msg_1",
    content: { type: "text", text: "I’ll create the file " },
  }),
  update({
    sessionUpdate: "agent_message_chunk",
    messageId: "msg_1",
    content: { type: "text", text: "and verify it." },
  }),
  update({
    sessionUpdate: "tool_call",
    toolCallId: "exec-edit",
    kind: "edit",
    title: "Editing files",
    status: "in_progress",
    content: [
      {
        type: "diff",
        oldText: null,
        newText: "acp works\n",
        path: "/vercel/sandbox/NOTES.md",
        _meta: { kind: "add" },
      },
    ],
  }),
  update({
    sessionUpdate: "tool_call_update",
    toolCallId: "exec-edit",
    status: "completed",
  }),
  update({ sessionUpdate: "usage_update", used: 12899, size: 258400 }),
  update({
    sessionUpdate: "agent_thought_chunk",
    messageId: "rs_1",
    content: { type: "text", text: "checking" },
  }),
  update({
    sessionUpdate: "tool_call",
    toolCallId: "exec-cmd",
    name: "exec_command",
    kind: "execute",
    title: "cat NOTES.md",
    status: "in_progress",
    rawInput: { command: "cat NOTES.md", cwd: "/vercel/sandbox" },
  }),
  update({
    sessionUpdate: "tool_call_update",
    toolCallId: "exec-cmd",
    status: "completed",
    rawOutput: { exit_code: 0 },
    _meta: {
      terminal_output_delta: { data: "acp works\n", terminal_id: "exec-cmd" },
    },
  }),
  update({
    sessionUpdate: "tool_call",
    toolCallId: "exec-mcp",
    kind: "execute",
    title: "mcp.deepwiki.read_wiki_structure",
    status: "in_progress",
    rawInput: {
      server: "deepwiki",
      tool: "read_wiki_structure",
      arguments: { repoName: "agentclientprotocol/agent-client-protocol" },
    },
    _meta: { is_mcp_tool_call: true },
  }),
  line({
    type: "permission",
    toolCall: { toolCallId: "exec-mcp", kind: "execute", status: "pending" },
    policy: "allow",
    outcome: "allow_once",
    optionName: "Allow",
  }),
  update({
    sessionUpdate: "tool_call_update",
    toolCallId: "exec-mcp",
    status: "completed",
    rawOutput: {
      result: {
        content: [{ type: "text", text: "1. Overview" }],
        structuredContent: null,
      },
      error: null,
    },
  }),
  update({
    sessionUpdate: "agent_message_chunk",
    messageId: "msg_2",
    content: { type: "text", text: "DONE" },
  }),
  update({
    sessionUpdate: "session_info_update",
    _meta: { codex: { threadStatus: { type: "idle" } } },
  }),
  line({ type: "done", stopReason: "end_turn", usage: { totalTokens: 13078 } }),
];

function renderAll(chunks: string[], stream = "stdout") {
  const renderer = createHarnessOutputRenderer("codex");
  let text = "";
  let segments: unknown[] = [];
  // A snapshot carries segments only when they changed; keep the latest.
  for (const rendered of [
    ...chunks.map((chunk) => renderer.push(stream, chunk)),
    renderer.flush(),
  ]) {
    text += rendered.text;
    segments = rendered.segments ?? segments;
  }
  return { text, segments };
}

describe("ACP harness output", () => {
  it("should render a codex-acp turn as text and tool calls in order", () => {
    const { text, segments } = renderAll(REAL_TURN);

    expect(text).toBe("I’ll create the file and verify it.\n\nDONE");
    expect(segments).toEqual([
      { type: "text", text: "I’ll create the file and verify it." },
      {
        type: "tool-call",
        toolCall: {
          id: "exec-edit",
          name: "PatchApply",
          input: {
            changes: [{ path: "/vercel/sandbox/NOTES.md", kind: "add" }],
          },
          state: "done",
        },
      },
      {
        type: "tool-call",
        toolCall: {
          id: "exec-cmd",
          name: "Command",
          input: { command: "cat NOTES.md" },
          output: { output: "acp works\n", exit_code: 0 },
          state: "done",
        },
      },
      {
        type: "tool-call",
        toolCall: {
          id: "exec-mcp",
          name: "MCP deepwiki/read_wiki_structure",
          input: { repoName: "agentclientprotocol/agent-client-protocol" },
          output: [{ type: "text", text: "1. Overview" }],
          state: "done",
        },
      },
      { type: "text", text: "\n\nDONE" },
    ]);
  });

  it("should render the same turn when lines arrive split across chunks", () => {
    const joined = REAL_TURN.join("");
    const pieces = joined.match(/[\S\s]{1,37}/g) ?? [];

    expect(renderAll(pieces)).toEqual(renderAll(REAL_TURN));
  });

  it("should show a declined request as denied even after the agent reports it failed", () => {
    const { segments } = renderAll([
      line({ type: "start" }),
      update({
        sessionUpdate: "tool_call",
        toolCallId: "net",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "curl -sI https://example.com" },
      }),
      line({
        type: "permission",
        toolCall: { toolCallId: "net" },
        policy: "decline",
        outcome: "reject_once",
        optionName: "No, continue without running it",
      }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "net",
        status: "failed",
      }),
    ]);

    expect(segments).toEqual([
      {
        type: "tool-call",
        toolCall: {
          id: "net",
          name: "Command",
          input: { command: "curl -sI https://example.com" },
          output: undefined,
          state: "denied",
        },
      },
    ]);
  });

  it("should report a fresh start, bridge errors, and an unusual stop as status text", () => {
    const { text } = renderAll([
      line({ type: "start" }),
      line({
        type: "resume_failed",
        sessionId: "old",
        message: "no rollout found",
      }),
      line({ type: "done", stopReason: "max_tokens", usage: null }),
      line({
        type: "error",
        message: "The agent exited before the turn finished (1)",
      }),
    ]);

    expect(text).toBe(
      "[previous session unavailable; starting fresh]\n[agent stopped: max_tokens]\nThe agent exited before the turn finished (1)"
    );
  });

  it("should keep the agent's stderr logs out of the transcript", () => {
    const renderer = createHarnessOutputRenderer("codex");
    renderer.push("stdout", line({ type: "start" }));

    expect(renderer.push("stderr", "[codex-acp] Startup {...}\n")).toEqual({
      text: "",
    });
  });

  it("should still render Codex CLI output with the CLI renderer", () => {
    const renderer = createHarnessOutputRenderer("codex");
    expect(renderer.push("stderr", "codex warning line\n").text).toBe(
      "codex warning line"
    );

    const rendered = renderer.push(
      "stdout",
      '{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"CLI turn"}}\n'
    );

    expect(rendered.text).toBe("\n\nCLI turn");
  });

  it("should take the resume id from the bridge's session event", () => {
    const parser = createHarnessSessionParser("codex");

    expect(parser.push("stdout", REAL_TURN.slice(0, 2).join(""))).toBeNull();
    expect(parser.push("stdout", REAL_TURN[2])).toBe(
      "01a0ea14-f930-74f0-8bbc-f322cdfb36b6"
    );
    // An agent message that mentions a session id is not a session event.
    expect(
      parser.push(
        "stdout",
        update({
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "session id: 11111111-2222-4333-8444-555555555555",
          },
        })
      )
    ).toBeNull();
  });
});
