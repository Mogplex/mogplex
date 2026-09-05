import { expect, it } from "vitest";
import type { UIMessage } from "ai";
import { controlMessageMetadata, latestControlContext } from "./context-usage";

const message = (metadata: unknown): UIMessage => ({
  id: "a",
  role: "assistant",
  parts: [],
  metadata,
});
it("uses only the latest model step, not totals or older turns", () => {
  const context = {
    model: "test-model",
    inputTokens: 10_000,
    outputTokens: 240,
  };
  expect(
    latestControlContext([
      message({ context: { ...context, inputTokens: 100_000 } }),
      message({ context, totalUsage: { inputTokens: 2_000_000 } }),
    ])
  ).toEqual(context);
  expect(
    latestControlContext([message({ context }), message({ ai_call_id: "new" })])
  ).toBeNull();
  expect(latestControlContext([])).toBeNull();
});
it.each([
  undefined,
  null,
  {},
  { model: "m", inputTokens: -1, outputTokens: 0 },
  { model: "m", inputTokens: Infinity, outputTokens: 0 },
])(
  "does not invent context from missing or invalid measurements: %j",
  (context) => {
    expect(latestControlContext([message({ context })])).toBeNull();
  }
);
it("emits one step measurement without repeating metadata on text chunks", () => {
  expect(controlMessageMetadata("call", "model", { type: "start" })).toEqual({
    ai_call_id: "call",
  });
  expect(
    controlMessageMetadata("call", "model", { type: "text-delta" })
  ).toBeUndefined();
  expect(
    controlMessageMetadata("call", "model", { type: "finish" })
  ).toBeUndefined();
  expect(
    controlMessageMetadata("call", "model", {
      type: "finish-step",
      usage: { inputTokens: 10_000, outputTokens: 240 },
    })
  ).toEqual({
    ai_call_id: "call",
    context: { model: "model", inputTokens: 10_000, outputTokens: 240 },
  });
  expect(
    controlMessageMetadata("call", "model", { type: "finish-step" })
  ).toEqual({ ai_call_id: "call", context: null });
});
