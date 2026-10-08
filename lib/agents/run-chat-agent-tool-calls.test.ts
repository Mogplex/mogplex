import { describe, expect, it } from "vitest";
import { EMPTY_CAPTURED_USAGE } from "@/lib/observability/usage";
import { buildRunChatAiCallRow, recordedToolCall } from "./run-chat-agent";

function completion(
  overrides: Partial<Parameters<typeof recordedToolCall>[0]> = {}
): Parameters<typeof recordedToolCall>[0] {
  return {
    toolCall: {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "start_repo_agent_run",
      input: { task: "Fix the coverage check", pullRequest: 599 },
    },
    durationMs: 42,
    success: true,
    output: { ok: true, runId: "run-1" },
    error: undefined,
    ...overrides,
  } as Parameters<typeof recordedToolCall>[0];
}

describe("Slack turn tool calls", () => {
  it("should record each tool's name, input, output, and duration", () => {
    expect(recordedToolCall(completion())).toEqual({
      name: "start_repo_agent_run",
      input: { task: "Fix the coverage check", pullRequest: 599 },
      output: { ok: true, runId: "run-1" },
      input_preview: '{"task":"Fix the coverage check","pullRequest":599}',
      output_preview: '{"ok":true,"runId":"run-1"}',
      duration_ms: 42,
    });
  });

  it("should record a failed tool's error as its output", () => {
    const call = recordedToolCall(
      completion({
        success: false,
        output: undefined,
        error: new Error("GitHub access is unavailable"),
      })
    );
    expect(call.output).toEqual({
      error: "GitHub access is unavailable",
    });
  });

  it("should store the tool calls on the turn's ai_calls row", () => {
    const toolCalls = [recordedToolCall(completion())];
    const row = buildRunChatAiCallRow({
      context: {
        userId: "user-1",
        conversationId: "conv-1",
      } as Parameters<typeof buildRunChatAiCallRow>[0]["context"],
      model: "anthropic/claude-opus-5.5",
      startedAt: new Date(0).toISOString(),
      startedAtMs: 0,
      status: "success",
      usage: EMPTY_CAPTURED_USAGE,
      toolCalls,
    });
    expect(row.tool_calls).toEqual(toolCalls);
    expect(row.tool_calls_count).toBe(1);
  });
});
