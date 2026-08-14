import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { ControlChatRegistry } from "../../components/control/use-control-chats";

function userMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

async function flushMicrotasks() {
  await new Promise<void>((resolve) => setImmediate(resolve));
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

test("ControlChatRegistry preserves local messages until persistence recovers", async () => {
  let settlePersist: ((result: "resolve" | "reject") => void) | undefined;
  const persistErrors: string[] = [];
  const registry = new ControlChatRegistry(
    () =>
      new Promise<void>((resolve, reject) => {
        settlePersist = (result) =>
          result === "resolve" ? resolve() : reject(new Error("offline"));
      }),
    () => {},
    () => {},
    (sessionId, failed) => {
      if (failed) persistErrors.push(sessionId);
    }
  );
  const local = [userMessage("local", "unsaved")];
  const stale = [userMessage("stale", "server")];

  assert.equal(registry.hydrate("session-a", local), true);
  const failedPersist = registry.persistFinishedMessages("session-a", local);
  assert.equal(registry.hydrate("session-a", stale), false);
  await flushMicrotasks();
  settlePersist?.("reject");
  await failedPersist;

  assert.equal(registry.hydrate("session-a", stale), false);
  assert.deepEqual(registry.get("session-a").messages, local);
  assert.deepEqual(persistErrors, ["session-a"]);

  const recoveredPersist = registry.persistFinishedMessages("session-a", local);
  assert.equal(registry.hydrate("session-a", stale), false);
  await flushMicrotasks();
  settlePersist?.("resolve");
  await recoveredPersist;
  assert.equal(registry.hydrate("session-a", stale), true);

  registry.dispose();
});

test("ControlChatRegistry serializes overlapping persists per session", async () => {
  const starts: string[] = [];
  const settlements: Array<(result: "resolve" | "reject") => void> = [];
  const states: boolean[] = [];
  const registry = new ControlChatRegistry(
    (_sessionId, messages) =>
      new Promise<void>((resolve, reject) => {
        starts.push(messages[0]?.id ?? "missing");
        settlements.push((result) =>
          result === "resolve" ? resolve() : reject(new Error("offline"))
        );
      }),
    () => {},
    () => {},
    (_sessionId, failed) => states.push(failed)
  );
  const older = [userMessage("older", "one")];
  const newer = [userMessage("newer", "two")];

  registry.hydrate("session-a", older);
  const first = registry.persistFinishedMessages("session-a", older);
  await flushMicrotasks();
  assert.deepEqual(starts, ["older"]);
  const second = registry.persistFinishedMessages("session-a", newer);

  settlements[0]?.("resolve");
  await first;
  await flushMicrotasks();
  assert.deepEqual(starts, ["older", "newer"]);
  assert.deepEqual(states, []);

  settlements[1]?.("reject");
  await second;
  assert.deepEqual(states, [true]);
  assert.equal(registry.hydrate("session-a", older), false);

  registry.dispose();
});
