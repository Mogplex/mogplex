import assert from "node:assert/strict";
import test from "node:test";
import { buildControlChatRunMetadata } from "../../lib/control/chat/context";

test("hosted Control follow-ups use a server-owned runtime marker", () => {
  const body = { messages: [], control_runtime: "background" };
  assert.equal(
    buildControlChatRunMetadata(body, null).control_runtime,
    "request"
  );
  assert.equal(
    buildControlChatRunMetadata(body, null, "background").control_runtime,
    "background"
  );
});
