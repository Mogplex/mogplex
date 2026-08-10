import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { buildCombinedTimeline } from "../../components/control/build-combined-timeline";

test("buildCombinedTimeline renders user messages as YOU events", () => {
  const messages = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Investigate the auth bug" }],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "Found it." }],
    },
  ] as UIMessage[];

  const events = buildCombinedTimeline([], messages);

  assert.deepEqual(
    events.map((event) => [event.kind, event.body]),
    [
      ["user", "Investigate the auth bug"],
      ["tool", "Found it."],
    ]
  );
  assert.equal(events[0]?.kind === "user" && events[0].label, "YOU");
});

test("buildCombinedTimeline describes attachment-only user messages", () => {
  const messages = [
    {
      id: "u1",
      role: "user",
      parts: [
        {
          type: "file",
          filename: "notes.md",
          mediaType: "text/markdown",
          url: "data:text/markdown;base64,aaa",
        },
      ],
    },
  ] as unknown as UIMessage[];

  const events = buildCombinedTimeline([], messages);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "user");
  assert.equal(events[0]?.body, "1 attachment included.");
});
