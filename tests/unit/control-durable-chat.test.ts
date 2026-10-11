import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { ControlChatRegistry } from "../../components/control/use-control-chats";

test("a queued turn stays active after HTTP completion, survives reload, and displays its final result without resubmitting", async () => {
  const original = globalThis.fetch;
  const sessionId = "00000000-0000-4000-8000-000000000003";
  let status = "streaming";
  let posts = 0;
  let messages: UIMessage[] = [
    { id: "user", role: "user", parts: [{ type: "text", text: "Run tests" }] },
  ];
  globalThis.fetch = async (url) => {
    if (String(url) === "/api/control/chat") {
      posts++;
      return createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) =>
            writer.write({
              type: "data-control-turn",
              data: { sessionId, aiCallId: "call" },
              transient: true,
            }),
        }),
      });
    }
    return Response.json({
      sessionId,
      messages,
      call: {
        id: "call",
        status,
        error:
          status === "failed"
            ? "Agent interrupted; saved work is available."
            : null,
      },
    });
  };
  let latest:
    | { status: string; messages: UIMessage[]; error?: Error }
    | undefined;
  let writes = 0;
  const registry = new ControlChatRegistry(
    async () => {
      writes++;
    },
    () => {},
    (_id, snapshot) => {
      latest = snapshot;
    }
  );
  try {
    const chat = registry.get(sessionId);
    await chat.sendMessage({ text: "Run tests" });
    await registry.refreshRemote(sessionId);
    assert.equal(chat.status, "ready");
    assert.equal(latest?.status, "streaming");
    assert.equal(writes, 0);
    assert.equal(registry.canArchive(sessionId), false);
    await assert.rejects(
      chat.sendMessage({ text: "Duplicate" }),
      /already running/
    );
    registry.dispose();
    const restored = new ControlChatRegistry(
      async () => {
        writes++;
      },
      () => {},
      (_id, snapshot) => {
        latest = snapshot;
      }
    );
    restored.get(sessionId);
    await restored.refreshRemote(sessionId);
    assert.equal(latest?.status, "streaming");
    status = "failed";
    messages = [
      ...messages,
      {
        id: "partial",
        role: "assistant",
        parts: [{ type: "text", text: "Tests passed; build unverified." }],
      },
    ];
    await restored.refreshRemote(sessionId);
    assert.equal(latest?.status, "ready");
    assert.match(latest?.error?.message ?? "", /Agent interrupted/);
    assert.deepEqual(latest?.messages, messages);
    assert.equal(posts, 1);
    restored.dispose();
  } finally {
    registry.dispose();
    globalThis.fetch = original;
  }
});
