import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { ControlChatRegistry } from "../../components/control/use-control-chats";

const conflict = "A turn is already running on this conversation.";
const remote: UIMessage[] = [
  {
    id: "remote",
    role: "assistant",
    parts: [{ type: "text", text: "The other tab is working" }],
  },
];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a rejected turn refreshes its transcript without replaying or persisting the rejected message", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  let persisted = 0;
  const registry = new ControlChatRegistry(
    async () => {
      persisted++;
    },
    () => {},
    () => {}
  );
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    return url.includes("/sessions?")
      ? Response.json({ id: "target", messages: remote })
      : Response.json({ error: conflict }, { status: 409 });
  };
  try {
    const chat = registry.get("target");
    await chat.sendMessage({ text: "My unsent draft" });
    await flush();
    assert.deepEqual(chat.messages, remote);
    assert.equal(
      chat.error?.message,
      conflict,
      "the composer keeps the rejected draft because the send remains unsuccessful"
    );
    assert.deepEqual(requests, [
      "/api/control/chat",
      "/api/control/sessions?id=target",
    ]);
    assert.equal(persisted, 0);
  } finally {
    globalThis.fetch = original;
    registry.dispose();
  }
});

test("a delayed conflict refresh cannot overwrite a replacement chat", async () => {
  const original = globalThis.fetch;
  let answer: ((response: Response) => void) | undefined;
  const registry = new ControlChatRegistry(
    async () => {},
    () => {},
    () => {}
  );
  globalThis.fetch = async (input) =>
    String(input).includes("/sessions?")
      ? new Promise<Response>((resolve) => {
          answer = resolve;
        })
      : Response.json({ error: conflict }, { status: 409 });
  try {
    await registry.get("target").sendMessage({ text: "Rejected draft" });
    assert.ok(answer, "a conflict initiates a transcript read");
    registry.remove("target");
    const replacement = registry.get("target");
    replacement.messages = [
      {
        id: "replacement",
        role: "user",
        parts: [{ type: "text", text: "Current transcript" }],
      },
    ];
    answer(Response.json({ id: "target", messages: remote }));
    await flush();
    assert.equal(replacement.messages[0].id, "replacement");
  } finally {
    globalThis.fetch = original;
    registry.dispose();
  }
});

test("failed refreshes preserve local history and never retry a rejected turn", async () => {
  const original = globalThis.fetch;
  let posts = 0;
  let reads = 0;
  const registry = new ControlChatRegistry(
    async () => {},
    () => {},
    () => {}
  );
  globalThis.fetch = async (input) => {
    if (String(input).includes("/sessions?")) {
      reads++;
      return Response.json({ error: "Unavailable" }, { status: 503 });
    }
    posts++;
    return Response.json({ error: conflict }, { status: 409 });
  };
  try {
    const chat = registry.get("target");
    await chat.sendMessage({ text: "Keep this draft" });
    await flush();
    assert.equal(
      chat.messages[0].parts[0].type === "text" &&
        chat.messages[0].parts[0].text,
      "Keep this draft"
    );
    assert.equal(chat.error?.message, conflict);
    assert.equal(posts, 1);
    assert.equal(reads, 1);
  } finally {
    globalThis.fetch = original;
    registry.dispose();
  }
});
