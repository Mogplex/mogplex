import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeControlChatMessages,
  readLatestControlUserText,
} from "../../app/api/control/chat/_lib/messages";

test("control chat diagnostics follow only the latest user request", () => {
  const messages = normalizeControlChatMessages([
    {
      role: "user",
      parts: [{ type: "text", text: "Show raw infrastructure diagnostics" }],
    },
    {
      role: "assistant",
      parts: [{ type: "text", text: "Earlier response" }],
    },
    {
      role: "user",
      parts: [
        { type: "text", text: "Ship the fix" },
        { type: "text", text: "Keep the status actionable" },
      ],
    },
  ]);

  assert.equal(
    readLatestControlUserText(messages),
    "Ship the fix\nKeep the status actionable"
  );
});
