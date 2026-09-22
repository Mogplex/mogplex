import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

async function loadRoute() {
  process.env.MOGPLEX_DATA_BACKEND = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-key";
  return import("../../app/api/mcp-servers/[id]/test/route");
}
const id = "11111111-1111-4111-8111-111111111111";
const request = () =>
  new Request(`https://mogplex.com/api/mcp-servers/${id}/test`, {
    method: "POST",
  });

test("connection test requires authentication before reading saved data", async () => {
  const { createMcpServerTestHandler } = await loadRoute();
  const response = await createMcpServerTestHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  })(request(), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 401);
});

test("connection test rejects invalid identifiers", async () => {
  const { createMcpServerTestHandler } = await loadRoute();
  const response = await createMcpServerTestHandler({
    requireUserId: async () => "owner",
  })(request(), { params: Promise.resolve({ id: "bad-id" }) });
  assert.equal(response.status, 400);
});

test("connection test returns a private, uncached result from the saved record and ignores supplied URLs", async (t) => {
  const { createMcpServerTestHandler } = await loadRoute();
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, "db.example.com");
    assert.equal(url.searchParams.get("user_id"), "eq.owner");
    assert.equal(url.searchParams.get("id"), `eq.${id}`);
    return Response.json({
      id,
      transport: "stdio",
      updated_at: "2026-09-22T00:00:00Z",
    });
  });
  const response = await createMcpServerTestHandler({
    requireUserId: async () => "owner",
  })(
    new Request(request(), {
      method: "POST",
      body: JSON.stringify({
        url: "http://127.0.0.1/private",
        header_refs: { Authorization: "other-secret" },
      }),
    }),
    { params: Promise.resolve({ id }) }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).code, "cli_only");
});

test("connection test returns 404 for a missing or inaccessible saved record", async (t) => {
  const { createMcpServerTestHandler } = await loadRoute();
  t.mock.method(globalThis, "fetch", async () => Response.json(null));
  const response = await createMcpServerTestHandler({
    requireUserId: async () => "owner",
  })(request(), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 404);
});
