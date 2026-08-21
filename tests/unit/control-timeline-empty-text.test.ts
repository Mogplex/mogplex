import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { buildCombinedTimeline } from "../../components/control/build-combined-timeline";

test("buildCombinedTimeline skips empty assistant text parts between tool calls", () => {
  const messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "" },
        {
          type: "tool-web_fetch",
          toolCallId: "t1",
          state: "output-available",
          input: { url: "https://example.com" },
          output: "ok",
        },
        { type: "text", text: "   " },
        { type: "text", text: "Here are the results." },
      ],
    },
  ] as unknown as UIMessage[];

  const events = buildCombinedTimeline([], messages);

  assert.deepEqual(
    events.map((event) => [event.kind, event.label]),
    [
      ["tool", "TOOL"],
      ["assistant", "MOGPLEX"],
    ]
  );
  assert.equal(events.at(-1)?.body, "Here are the results.");
});
