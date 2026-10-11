import assert from "node:assert/strict";
import test from "node:test";
import { createControlStepCheckpoint } from "@/lib/control/step-checkpoint";
import {
  finalizeCancelledControlRun,
  finalizeFinishedControlRun,
} from "@/app/api/control/chat/_lib/lifecycle";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildAiCall } from "./helpers/sandbox-harness-route-fixtures";

for (const outcome of ["success", "error", "cancelled"] as const) {
  test(`Control preserves every completed generation through ${outcome}`, async () => {
    const updates: Record<string, unknown>[] = [];
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
        update: (payload: Record<string, unknown>) => {
          assert.equal(table, "ai_calls");
          updates.push(payload);
          const query = {
            eq: () => query,
            in: () => query,
            select: () => query,
            maybeSingle: async () => ({ data: payload, error: null }),
          };
          return query;
        },
        insert: (payload: Record<string, unknown>) => ({
          select: () => ({
            single: async () => ({ data: payload, error: null }),
          }),
        }),
      }),
    });
    try {
      const call = buildAiCall({ id: "control-usage", status: "streaming" });
      const checkpoint = createControlStepCheckpoint(call);
      for (const generationId of ["gen_first", "gen_second"]) {
        await checkpoint({
          usage: {
            inputTokens: 10,
            outputTokens: 3,
            totalTokens: 13,
            inputTokenDetails: {
              noCacheTokens: 8,
              cacheReadTokens: 2,
              cacheWriteTokens: 0,
            },
            outputTokenDetails: { textTokens: 2, reasoningTokens: 1 },
          },
          providerMetadata: { gateway: { generationId } },
        });
      }
      assert.deepEqual(updates[0].gateway_generation_ids, ["gen_first"]);
      assert.deepEqual(updates[1].gateway_generation_ids, [
        "gen_first",
        "gen_second",
      ]);
      // Gateway supplies the ID on a content chunk even if this request
      // fails before the SDK can produce a completed step.
      await checkpoint({
        providerMetadata: { gateway: { generationId: "gen_partial" } },
      });
      await checkpoint({
        providerMetadata: { gateway: { generationId: "gen_partial" } },
      });
      assert.equal(updates.length, 3, "repeated chunks do not write again");
      const input = {
        activeCall: call,
        userId: call.user_id,
        scope: { conversationId: null, repoId: null, missionId: null },
        limitClaimId: null,
        callStartedAt: call.started_at,
        steps: [],
      };
      await (outcome === "cancelled"
        ? finalizeCancelledControlRun(input)
        : finalizeFinishedControlRun({
            ...input,
            finishReason: outcome === "success" ? "stop" : "error",
            providerMetadata: { gateway: { generationId: "gen_second" } },
          }));
      const saved = updates.at(-1)!;
      assert.equal(saved.status, outcome === "error" ? "failed" : outcome);
      assert.equal(saved.input_tokens, 20);
      assert.equal(saved.output_tokens, 6);
      assert.equal(saved.cache_read_input_tokens, 4);
      assert.equal(saved.reasoning_tokens, 2);
      assert.equal(saved.gateway_generation_id, "gen_first");
      assert.deepEqual(saved.gateway_generation_ids, [
        "gen_first",
        "gen_second",
        "gen_partial",
      ]);
    } finally {
      if (descriptor) Object.defineProperty(supabaseAdmin, "from", descriptor);
      else Reflect.deleteProperty(supabaseAdmin, "from");
      if (thenDescriptor)
        Object.defineProperty(supabaseAdmin, "then", thenDescriptor);
      else Reflect.deleteProperty(supabaseAdmin, "then");
    }
  });
}
