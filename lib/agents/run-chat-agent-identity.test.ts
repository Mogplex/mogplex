import { afterEach, expect, it, vi } from "vitest";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { NO_CONVERSATION_SKILLS } from "@/lib/skill-catalog/chat";
import { runChatAgent } from "./run-chat-agent";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([undefined, "00000000-0000-4000-8000-000000000099"])(
  "uses only the owning ai_call %s for Slack cleanup exclusion",
  async (aiCallId) => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    vi.stubEnv("INTERNAL_API_SECRET", "test-internal-api-secret");
    let stopBody: Record<string, unknown> | undefined;
    let recordedStatus: string | undefined;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/sandbox/sandbox-1/stop")) {
          expect(recordedStatus).toBe("success");
          stopBody = JSON.parse(String(init?.body));
          return Response.json({
            sandbox: { runtime_summary: { status: "stopped" } },
          });
        }
        return Response.json({
          status: "running",
          preview_url: null,
        });
      }
    );
    let step = 0;
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    type StreamPart =
      Awaited<
        ReturnType<MockLanguageModelV4["doStream"]>
      >["stream"] extends ReadableStream<infer Part>
        ? Part
        : never;
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            const chunks: StreamPart[] =
              step++ === 0
                ? [
                    { type: "stream-start", warnings: [] },
                    {
                      type: "tool-call",
                      toolCallId: "cmd",
                      toolName: "bash",
                      input: JSON.stringify({ command: "pnpm typecheck" }),
                    },
                    {
                      type: "finish",
                      finishReason: { unified: "tool-calls", raw: "tool_use" },
                      usage,
                    },
                  ]
                : [
                    { type: "stream-start", warnings: [] },
                    { type: "text-start", id: "reply" },
                    {
                      type: "text-delta",
                      id: "reply",
                      delta: "Typecheck passed.",
                    },
                    { type: "text-end", id: "reply" },
                    {
                      type: "finish",
                      finishReason: { unified: "stop", raw: "stop" },
                      usage,
                    },
                  ];
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
      }),
    });
    const result = await runChatAgent({
      userId: "user-1",
      aiCallId,
      model: "test/model",
      sandboxId: "sandbox-1",
      toolExecutionIdempotencyKey: "slack:event:123.456",
      messages: [{ role: "user", content: "Run checks" }],
      latestUserText: "Run checks",
      additionalTools: {
        bash: tool({
          inputSchema: z.object({ command: z.string() }),
          execute: async () => ({ sandboxId: "sandbox-1", exitCode: 0 }),
        }),
      },
      deps: {
        stream: {
          resolveModel: (async () => ({ model, providerOptions: {} })) as never,
          buildTools: (async () => ({
            tools: {},
            connections: [],
            cleanup: async () => {},
          })) as never,
          resolveSkills: async () => NO_CONVERSATION_SKILLS,
        },
        recordAiCall: async (record) => {
          recordedStatus = record.status;
        },
      },
    });
    expect(stopBody?.automatic).toBe(true);
    expect(stopBody?.completingAiCallId).toBe(aiCallId);
    expect(result.finalText).toBe("Typecheck passed.");
  }
);
