import assert from "node:assert/strict";
import test from "node:test";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { ControlChatRegistry } from "../../components/control/control-chat-registry";

for (const approved of [true, false]) {
  test(`a restored approval sends its own conversation identity: ${approved}`, async () => {
    const originalFetch = globalThis.fetch;
    const submitted = Promise.withResolvers<Record<string, unknown>>();
    const registry = new ControlChatRegistry(
      async () => {},
      () => {},
      () => {}
    );
    globalThis.fetch = async (_url, init) => {
      submitted.resolve(JSON.parse(String(init?.body)));
      return createUIMessageStreamResponse({
        stream: createUIMessageStream({ execute: () => {} }),
      });
    };
    try {
      // This Chat has never sent a message: the approval survived a reload.
      registry.hydrate("restored-session", [
        {
          id: "assistant",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "open_pr",
              toolCallId: "open-pr",
              state: "approval-requested",
              input: { title: "Saved change" },
              approval: { id: "approval" },
            },
          ],
        },
      ]);
      registry.get("another-session");
      await registry.get("restored-session").addToolApprovalResponse({
        id: "approval",
        approved,
      });
      const body = await submitted.promise;
      assert.equal(body.conversationId, "restored-session");
      assert.equal(
        (body.messages as Array<{ role: string }>).at(-1)?.role,
        "assistant"
      );
    } finally {
      registry.dispose();
      globalThis.fetch = originalFetch;
    }
  });
}
