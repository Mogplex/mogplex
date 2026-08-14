import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import {
  persistBackedControlSessionMessages,
  persistControlSessionMessages,
} from "../../lib/control/session-persistence";

const messages: UIMessage[] = [
  { id: "message-1", role: "user", parts: [{ type: "text", text: "hi" }] },
];

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("mission-only chats without a database revision stay local", async () => {
  let requests = 0;
  const persisted = await persistBackedControlSessionMessages({
    sessionId: "mission-only",
    messages,
    expectedUpdatedAt: undefined,
    fetcher: async () => {
      requests += 1;
      return jsonResponse(500, {});
    },
  });

  assert.equal(persisted, null);
  assert.equal(requests, 0);
});

test("persistControlSessionMessages rejects a failed write", async () => {
  await assert.rejects(
    persistControlSessionMessages({
      sessionId: "session-a",
      messages,
      expectedUpdatedAt: "revision-1",
      fetcher: async () => jsonResponse(500, {}),
    }),
    /Failed to persist control session \(500\)/
  );
});

test("persistControlSessionMessages rejects a failed conflict rebase", async () => {
  let requests = 0;
  await assert.rejects(
    persistControlSessionMessages({
      sessionId: "session-a",
      messages,
      expectedUpdatedAt: "revision-1",
      fetcher: async () =>
        ++requests === 1 ? jsonResponse(409, {}) : jsonResponse(503, {}),
    }),
    /Failed to rebase control session \(503\)/
  );
  assert.equal(requests, 2);
});

test("persistControlSessionMessages retries a conflict with the fresh revision", async () => {
  const bodies: unknown[] = [];
  const session = {
    id: "session-a",
    title: "Session",
    project: null,
    repo_id: null,
    orchestration_run_id: null,
    pinned: false,
    updated_at: "revision-3",
    messages,
  };
  const responses = [
    jsonResponse(409, {}),
    jsonResponse(200, { ...session, updated_at: "revision-2" }),
    jsonResponse(200, { session }),
  ];

  const persisted = await persistControlSessionMessages({
    sessionId: "session-a",
    messages,
    expectedUpdatedAt: "revision-1",
    fetcher: async (_input, init) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return responses.shift() ?? jsonResponse(500, {});
    },
  });

  assert.equal(persisted.updated_at, "revision-3");
  assert.deepEqual(
    bodies.map(
      (body) => (body as { expected_updated_at: string }).expected_updated_at
    ),
    ["revision-1", "revision-2"]
  );
});
