import assert from "node:assert/strict";
import test from "node:test";
import { streamText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { createChatFinalizationHooks } from "@/app/api/chat/_lib/lifecycle";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildAiCall } from "./helpers/sandbox-harness-route-fixtures";

for (const scenario of [
  "provider-throw",
  "error-frame",
  "after-tool",
  "success",
] as const) {
  test(`chat finalizes once on ${scenario} and preserves completed work`, async () => {
    const updates: Record<string, unknown>[] = [];
    const events: Record<string, unknown>[] = [];
    let releases = 0;
    const descriptor = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
    const thenDescriptor = Object.getOwnPropertyDescriptor(
      supabaseAdmin,
      "then"
    );
    Object.defineProperty(supabaseAdmin, "then", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      value: (table: string) => ({
        delete: () => {
          assert.equal(table, "limit_events");
          const filters: Record<string, string> = {};
          const query = {
            error: null,
            eq(column: string, value: string) {
              filters[column] = value;
              if (column === "claim_id") {
                assert.deepEqual(filters, {
                  user_id: "user-123",
                  route_key: "chat",
                  decision: "allowed",
                  claim_id: "chat-claim",
                });
                releases += 1;
              }
              return query;
            },
          };
          return query;
        },
        update: (payload: Record<string, unknown>) => ({
          eq: async (_column: string, id: string) => {
            assert.equal(table, "ai_calls");
            assert.equal(id, "chat-error");
            updates.push(payload);
            return { error: null };
          },
        }),
        insert: (payload: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              assert.equal(table, "ai_call_events");
              events.push(payload);
              return { data: payload, error: null };
            },
          }),
        }),
      }),
    });
    try {
      const activeCall = buildAiCall({
        id: "chat-error",
        type: "chat",
        status: "streaming",
      });
      const hooks = createChatFinalizationHooks({
        activeCall,
        userId: activeCall.user_id,
        scope: { conversationId: null, repoId: null },
        limitClaimId: "chat-claim",
        callStartedAt: activeCall.started_at,
      });
      const model = new MockLanguageModelV3({
        doStream: async () => {
          if (scenario === "provider-throw" || model.doStreamCalls.length > 1)
            throw new Error("private-provider-diagnostic");
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: "stream-start", warnings: [] });
                if (scenario === "error-frame") {
                  controller.enqueue({
                    type: "error",
                    error: new Error("private-provider-diagnostic"),
                  });
                } else {
                  if (scenario === "after-tool")
                    controller.enqueue({
                      type: "tool-call",
                      toolCallId: "completed-command",
                      toolName: "bash",
                      input: "{}",
                    });
                  else {
                    controller.enqueue({ type: "text-start", id: "answer" });
                    controller.enqueue({
                      type: "text-delta",
                      id: "answer",
                      delta: "done",
                    });
                    controller.enqueue({ type: "text-end", id: "answer" });
                  }
                  controller.enqueue({
                    type: "finish",
                    finishReason: {
                      unified:
                        scenario === "after-tool" ? "tool-calls" : "stop",
                      raw: "stop",
                    },
                    usage: {
                      inputTokens: {
                        total: 2,
                        noCache: 1,
                        cacheRead: 1,
                        cacheWrite: 0,
                      },
                      outputTokens: { total: 1, text: 1, reasoning: 0 },
                    },
                  });
                }
                controller.close();
              },
            }),
          };
        },
      });
      let commandExecutions = 0;
      const result = streamText({
        model,
        prompt: "hello",
        maxRetries: 0,
        stopWhen: stepCountIs(3),
        tools: {
          bash: tool({
            inputSchema: z.object({}),
            execute: async () => {
              commandExecutions += 1;
              return "completed-output";
            },
          }),
        },
        ...hooks,
      });
      await result.toUIMessageStreamResponse().text();
      assert.equal(updates.length, 1);
      assert.equal(
        updates[0].status,
        scenario === "success" ? "success" : "failed"
      );
      assert.ok(updates[0].completed_at);
      assert.equal(events.length, 1);
      assert.equal(
        events[0].event_type,
        scenario === "success" ? "finished" : "failed"
      );
      assert.doesNotMatch(
        JSON.stringify({ updates, events }),
        /private-provider-diagnostic/
      );
      await hooks.onAbort?.({ steps: [] });
      await hooks.onError?.({ error: new Error("late-error") });
      assert.equal(updates.length, 1, "a later abort cannot overwrite failure");
      assert.equal(releases, 1);
      assert.equal(
        model.doStreamCalls.length,
        scenario === "after-tool" ? 2 : 1
      );
      assert.equal(
        commandExecutions,
        scenario === "after-tool" ? 1 : 0,
        "no command replay"
      );
      if (scenario === "success" || scenario === "after-tool") {
        assert.equal(updates[0].input_tokens, 2);
        assert.equal(updates[0].output_tokens, 1);
        assert.equal(updates[0].cache_read_input_tokens, 1);
      }
      if (scenario === "after-tool") {
        assert.equal(updates[0].tool_calls_count, 1);
        assert.match(JSON.stringify(updates[0].tool_calls), /completed-output/);
      }
    } finally {
      if (descriptor) Object.defineProperty(supabaseAdmin, "from", descriptor);
      else Reflect.deleteProperty(supabaseAdmin, "from");
      if (thenDescriptor)
        Object.defineProperty(supabaseAdmin, "then", thenDescriptor);
      else Reflect.deleteProperty(supabaseAdmin, "then");
    }
  });
}
