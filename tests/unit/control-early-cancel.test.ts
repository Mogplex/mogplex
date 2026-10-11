import assert from "node:assert/strict";
import { test } from "node:test";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { ControlChatRegistry } from "../../components/control/use-control-chats";

const sessionId = "00000000-0000-4000-8000-000000000003";
const messages = [
  { id: "user", role: "user", parts: [{ type: "text", text: "Canary" }] },
];

test(
  "Stop before queue acknowledgement cancels the admitted run without losing its identity",
  { timeout: 2000 },
  async () => {
    const original = globalThis.fetch;
    const started = Promise.withResolvers<void>();
    const acknowledged = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    let requestSignal: AbortSignal | null | undefined;
    let status = "pending";
    const cancellationIds: string[] = [];
    globalThis.fetch = async (url, init) => {
      if (String(url) === "/api/control/chat") {
        requestSignal = init?.signal;
        started.resolve();
        return createUIMessageStreamResponse({
          stream: createUIMessageStream({
            execute: async ({ writer }) => {
              await acknowledged.promise;
              writer.write({
                type: "data-control-turn",
                data: { sessionId, aiCallId: "admitted-call" },
                transient: true,
              });
            },
          }),
        });
      }
      if (String(url).endsWith("/cancel")) {
        assert.equal(init?.method, "POST");
        cancellationIds.push(String(url));
        status = "cancelled";
        cancelled.resolve();
      }
      return Response.json({
        sessionId,
        messages,
        call: { id: "admitted-call", status },
      });
    };
    const registry = new ControlChatRegistry(
      async () => {},
      () => {},
      () => {}
    );
    const chat = registry.get(sessionId);
    const sent = chat.sendMessage({ text: "Canary" });
    try {
      await started.promise;
      await chat.stop();
      assert.equal(
        requestSignal?.aborted,
        false,
        "Keep the acknowledgement connection until the admitted run can be cancelled"
      );
      acknowledged.resolve();
      await sent;
      await cancelled.promise;
      await registry.refreshRemote(sessionId);
      assert.deepEqual(cancellationIds, [
        "/api/observability/calls/admitted-call/cancel",
      ]);
      assert.equal(registry.canArchive(sessionId), true);
    } finally {
      acknowledged.resolve();
      await sent.catch(() => {});
      registry.dispose();
      globalThis.fetch = original;
    }
  }
);

test("a newly created empty conversation can refresh before its first request is saved", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ sessionId, messages: [], call: null });
  const registry = new ControlChatRegistry(
    async () => {},
    () => {},
    () => {}
  );
  try {
    const chat = registry.get(sessionId);
    await registry.refreshRemote(sessionId);
    assert.deepEqual(chat.messages, []);
    assert.equal(chat.status, "ready");
  } finally {
    registry.dispose();
    globalThis.fetch = original;
  }
});
