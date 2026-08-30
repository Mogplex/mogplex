import assert from "node:assert/strict";
import test from "node:test";
import { normalizeControlChatMessages } from "../../app/api/control/chat/_lib/messages";

test("control chat rejects malformed roles and parts", () => {
  assert.throws(
    () => normalizeControlChatMessages([{ role: "owner", parts: [] } as never]),
    /Invalid control chat message role/
  );
  assert.throws(
    () =>
      normalizeControlChatMessages([{ role: "user", parts: [null as never] }]),
    /Invalid control chat message part/
  );
  assert.throws(
    () =>
      normalizeControlChatMessages([
        { role: "user", parts: [{ type: "text" }] },
      ]),
    /Invalid control chat text part/
  );
});
