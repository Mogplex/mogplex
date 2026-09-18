import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse, type NextRequest } from "next/server";
import { makeClient, type Memory } from "./helpers/memories-client-fixtures";

async function loadRoutes() {
  const [list, actions] = await Promise.all([
    import("../../app/api/memories/route"),
    import("../../app/api/memories/actions/route"),
  ]);
  return { list, actions };
}

function request(url: string, init?: RequestInit): NextRequest {
  const req = new Request(url, init) as Request & { nextUrl?: URL };
  req.nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

function row(lane: Memory["lane"], id: string, content: string): Memory {
  return {
    id,
    lane,
    content,
    metadata: { source: "memories-pane" },
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  };
}

const unauthorized = async () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

test("GET /api/memories returns each lane plus exact per-lane counts", async () => {
  const { list } = await loadRoutes();
  const { client } = await makeClient({
    rows: [
      row("semantic", "s-1", "uses pnpm"),
      row("semantic", "s-2", "prefers vitest"),
      row("procedural", "p-1", "run typecheck before commit"),
    ],
  });
  const handler = list.createMemoriesGetHandler({
    requireUserId: async () => "user-A",
    createMemoriesClient: () => client,
  });

  const response = await handler(request("https://example.com/api/memories"));
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    semantic: Memory[];
    procedural: Memory[];
    session: Memory[];
    episodic: Memory[];
    counts: Record<string, number>;
  };
  assert.equal(payload.semantic.length, 2);
  assert.equal(payload.procedural.length, 1);
  assert.deepEqual(payload.counts, {
    session: 0,
    semantic: 2,
    episodic: 0,
    procedural: 1,
  });
});

test("GET /api/memories rejects an unknown lane and unauthenticated callers", async () => {
  const { list } = await loadRoutes();
  const { client } = await makeClient();
  const handler = list.createMemoriesGetHandler({
    requireUserId: async () => "user-A",
    createMemoriesClient: () => client,
  });
  const bad = await handler(
    request("https://example.com/api/memories?lane=dreams")
  );
  assert.equal(bad.status, 400);

  const anonymous = list.createMemoriesGetHandler({
    requireUserId: unauthorized,
    createMemoriesClient: () => {
      throw new Error("must not build a client without a user");
    },
  });
  const denied = await anonymous(request("https://example.com/api/memories"));
  assert.equal(denied.status, 401);
});

test("POST /api/memories/actions prune_noise deletes harness prompt dumps and automation outcomes", async () => {
  const { actions } = await loadRoutes();
  const { client, calls, setAffectedIds } = await makeClient();
  setAffectedIds(["x", "y"]);
  const handler = actions.createMemoriesActionsPostHandler({
    requireUserId: async () => "user-A",
    createMemoriesClient: () => client,
  });

  const response = await handler(
    request("https://example.com/api/memories/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prune_noise" }),
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    pruned: { harnessPrompts: 2, automationOutcomes: 2 },
  });
  const deletes = calls.filter((c) => c.method === "memories.delete");
  assert.equal(deletes.length, 2);
  assert.ok(deletes.every((c) => c.args.user_id === "user-A"));
});

test("POST /api/memories/actions rejects unknown actions, bad bodies, and anonymous callers", async () => {
  const { actions } = await loadRoutes();
  const { client } = await makeClient();
  const handler = actions.createMemoriesActionsPostHandler({
    requireUserId: async () => "user-A",
    createMemoriesClient: () => client,
  });

  const unknown = await handler(
    request("https://example.com/api/memories/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "explode" }),
    })
  );
  assert.equal(unknown.status, 400);

  const malformed = await handler(
    request("https://example.com/api/memories/actions", {
      method: "POST",
      body: "not json",
    })
  );
  assert.equal(malformed.status, 400);

  const anonymous = actions.createMemoriesActionsPostHandler({
    requireUserId: unauthorized,
    createMemoriesClient: () => client,
  });
  const denied = await anonymous(
    request("https://example.com/api/memories/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "compact" }),
    })
  );
  assert.equal(denied.status, 401);
});
