import { describe, expect, it } from "vitest";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { EMPTY_CAPTURED_USAGE } from "@/lib/observability/usage";
import { NO_CONVERSATION_SKILLS } from "@/lib/skill-catalog/chat";
import {
  buildRunChatAiCallRow,
  recordedToolCall,
  runChatAgent,
  type RunChatAiCallRecord,
} from "./run-chat-agent";

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

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function streamOf(chunks: unknown[]) {
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  };
}

describe("runChatAgent", () => {
  it("should write the tools a Slack turn called onto its ai_calls row", async () => {
    let step = 0;
    const model = new MockLanguageModelV4({
      doStream: async () =>
        step++ === 0
          ? streamOf([
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "start_repo_agent_run",
                input: JSON.stringify({ task: "Fix it" }),
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_use" },
                usage,
              },
            ])
          : streamOf([
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "Started a run." },
              { type: "text-end", id: "t1" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage,
              },
            ]),
    });
    const records: RunChatAiCallRecord[] = [];

    await runChatAgent({
      userId: "user-1",
      model: "test/model",
      messages: [{ role: "user", content: "Fix PR 599" }],
      latestUserText: "Fix PR 599",
      additionalTools: {
        start_repo_agent_run: tool({
          inputSchema: z.object({ task: z.string() }),
          execute: async () => ({ ok: true, runId: "run-1" }),
        }),
      },
      deps: {
        stream: {
          resolveModel: (async () => ({
            model,
            providerOptions: {},
          })) as never,
          buildTools: (async () => ({
            tools: {},
            connections: [],
            cleanup: async () => {},
          })) as never,
          resolveSkills: async () => NO_CONVERSATION_SKILLS,
        },
        recordAiCall: (record) => {
          records.push(record);
        },
      },
    });

    const row = buildRunChatAiCallRow(records[0]);
    expect(row.tool_calls_count).toBe(1);
    expect(row.tool_calls[0]).toMatchObject({
      name: "start_repo_agent_run",
      input: { task: "Fix it" },
      output: { ok: true, runId: "run-1" },
    });
  });
});
