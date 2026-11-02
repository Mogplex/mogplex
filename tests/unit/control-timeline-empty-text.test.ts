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

test("saved replies hide legacy routine compute footers without hiding warnings or user text", () => {
  const footer = "Compute: still running because this is a persistent session.";
  const warning =
    "Compute: still running because an automatic stop could not be confirmed.";
  const messages: UIMessage[] = [
    { id: "user", role: "user", parts: [{ type: "text", text: footer }] },
    {
      id: "reply",
      role: "assistant",
      parts: [
        { type: "text", text: "The tests passed." },
        { type: "text", text: footer },
        { type: "text", text: warning },
      ],
    },
  ];
  assert.deepEqual(
    buildCombinedTimeline([], messages).map((event) => event.body),
    [footer, "The tests passed.", warning]
  );
});
