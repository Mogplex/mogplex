import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { ControlChatRegistry } from "../../components/control/use-control-chats";

function userMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

test("ControlChatRegistry observes independent real Chat stores", () => {
  const snapshots: Array<{ sessionId: string; messages: UIMessage[] }> = [];
  const registry = new ControlChatRegistry(
    async () => {},
    () => {},
    (sessionId, chat) => {
      snapshots.push({ sessionId, messages: chat.messages });
    }
  );

  const chatA = registry.get("session-a");
  const chatB = registry.get("session-b");
  assert.notEqual(chatA, chatB);

  assert.equal(
    registry.hydrate("session-a", [userMessage("a-1", "old")]),
    true
  );
  assert.equal(
    registry.hydrate("session-a", [userMessage("a-2", "fresh")]),
    true
  );
  chatB.messages = [userMessage("b-1", "parallel")];

  assert.deepEqual(
    snapshots.map(({ sessionId, messages }) => [
      sessionId,
      messages[0]?.parts[0]?.type === "text" ? messages[0].parts[0].text : null,
    ]),
    [
      ["session-a", "old"],
      ["session-a", "fresh"],
      ["session-b", "parallel"],
    ]
  );

  registry.dispose();
});
