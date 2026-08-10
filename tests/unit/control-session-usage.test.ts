import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import {
  extractAiCallIds,
  formatTokens,
} from "../../lib/control/session-usage";

test("extractAiCallIds pulls unique ai_call_id values from assistant metadata", () => {
  const messages = [
    { id: "u1", role: "user", parts: [], metadata: { ai_call_id: "ignored" } },
    { id: "a1", role: "assistant", parts: [] },
    {
      id: "a2",
      role: "assistant",
      parts: [],
      metadata: { ai_call_id: "call-1" },
    },
    {
      id: "a3",
      role: "assistant",
      parts: [],
      metadata: { ai_call_id: "call-2" },
    },
    {
      id: "a4",
      role: "assistant",
      parts: [],
      metadata: { ai_call_id: "call-1" },
    },
  ] as unknown as UIMessage[];

  assert.deepEqual(extractAiCallIds(messages), ["call-1", "call-2"]);
  assert.deepEqual(extractAiCallIds([]), []);
});

test("formatTokens compacts token counts", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(950), "950");
  assert.equal(formatTokens(45210), "45.2k");
  assert.equal(formatTokens(2_340_000), "2.3M");
});
