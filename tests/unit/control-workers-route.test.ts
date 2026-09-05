import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/control/workers/route");
}

test("worker route preserves auth failures and rejects missing session IDs before reading", async () => {
  const { createControlWorkersGetHandler } = await loadRoute();
  const noRead = async () => {
    throw new Error("must not read");
  };
  const request = new Request("https://mogplex.test/api/control/workers");
  assert.equal(
    (
      await createControlWorkersGetHandler({
        requireUserId: async () =>
          NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        loadWorkers: noRead,
      })(request)
    ).status,
    401
  );
  assert.equal(
    (
      await createControlWorkersGetHandler({
        requireUserId: async () => "owner",
        loadWorkers: noRead,
      })(request)
    ).status,
    400
  );
});

test("worker route returns an owned result, 404 for a hidden session and safe database errors", async () => {
  const { createControlWorkersGetHandler } = await loadRoute();
  const request = new Request(
    "https://mogplex.test/api/control/workers?sessionId=session"
  );
  const owned = createControlWorkersGetHandler({
    requireUserId: async () => "owner",
    loadWorkers: async (user, session) =>
      user === "owner" && session === "session" ? [] : null,
  });
  assert.deepEqual(await (await owned(request)).json(), { workers: [] });
  assert.equal(
    (
      await createControlWorkersGetHandler({
        requireUserId: async () => "owner",
        loadWorkers: async () => null,
      })(request)
    ).status,
    404
  );
  const failed = await createControlWorkersGetHandler({
    requireUserId: async () => "owner",
    loadWorkers: async () => {
      throw new Error("private database diagnostic");
    },
  })(request);
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {
    error: "Could not load worker status. Try again.",
  });
});
