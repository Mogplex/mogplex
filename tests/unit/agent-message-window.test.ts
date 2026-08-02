import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MESSAGE_WINDOW,
  windowMessages,
} from "../../lib/agents/message-window";

type Msg = { role: "user" | "assistant" | "system"; content: string };

function makeMessages(count: number, role: Msg["role"] = "user"): Msg[] {
  return Array.from({ length: count }, (_, i) => ({ role, content: `m${i}` }));
}

test("windowMessages returns the input unchanged when at or under the limit", () => {
  const under = makeMessages(5);
  assert.equal(windowMessages(under, 10), under);

  const exact = makeMessages(10);
  assert.equal(windowMessages(exact, 10), exact);

  assert.deepEqual(windowMessages([], 5), []);
});

test("windowMessages keeps only the last N messages when over the limit", () => {
  const windowed = windowMessages(makeMessages(15), 5);
  assert.equal(windowed.length, 5);
  assert.deepEqual(
    windowed.map((m) => m.content),
    ["m10", "m11", "m12", "m13", "m14"]
  );
});

test("windowMessages always preserves a leading system message", () => {
  const messages: Msg[] = [
    { role: "system", content: "sys" },
    ...makeMessages(15),
  ];
  const windowed = windowMessages(messages, 5);
  assert.equal(windowed.length, 6);
  assert.deepEqual(windowed[0], { role: "system", content: "sys" });
  assert.deepEqual(
    windowed.slice(1).map((m) => m.content),
    ["m10", "m11", "m12", "m13", "m14"]
  );
});

test("windowMessages uses DEFAULT_MESSAGE_WINDOW when no limit is given", () => {
  const windowed = windowMessages(makeMessages(DEFAULT_MESSAGE_WINDOW + 10));
  assert.equal(windowed.length, DEFAULT_MESSAGE_WINDOW);
  assert.equal(windowed[0].content, "m10");
});
