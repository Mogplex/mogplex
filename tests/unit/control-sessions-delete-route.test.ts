import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/control/sessions/route");
}

function deleteRequest(id?: string) {
  const search = id ? `?id=${encodeURIComponent(id)}` : "";
  return new Request(`https://app.mogplex.com/api/control/sessions${search}`, {
    method: "DELETE",
  });
}

test("DELETE preserves the auth response before touching session data", async () => {
  const { createControlSessionDeleteHandler } = await loadRoute();
  let deleteCalls = 0;
  const handler = createControlSessionDeleteHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    deleteOwnedSession: async () => {
      deleteCalls += 1;
      return { id: "session-1" };
    },
  });

  const response = await handler(deleteRequest("session-1"));

  assert.equal(response.status, 401);
  assert.equal(deleteCalls, 0);
});

test("DELETE rejects a missing session id", async () => {
  const { createControlSessionDeleteHandler } = await loadRoute();
  const handler = createControlSessionDeleteHandler({
    requireUserId: async () => "user-1",
    deleteOwnedSession: async () => {
      throw new Error("deleteOwnedSession should not be called");
    },
  });

  const response = await handler(deleteRequest());

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Missing id" });
});

test("DELETE removes only the authenticated user's chat", async () => {
  const { createControlSessionDeleteHandler } = await loadRoute();
  const seen: unknown[] = [];
  const handler = createControlSessionDeleteHandler({
    requireUserId: async () => "user-1",
    deleteOwnedSession: async (id, userId) => {
      seen.push({ id, userId });
      return { id };
    },
  });

  const response = await handler(deleteRequest("session-1"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: "session-1" });
  assert.deepEqual(seen, [{ id: "session-1", userId: "user-1" }]);
});

test("DELETE hides chats outside the authenticated user's scope", async () => {
  const { createControlSessionDeleteHandler } = await loadRoute();
  const handler = createControlSessionDeleteHandler({
    requireUserId: async () => "user-1",
    deleteOwnedSession: async () => null,
  });

  const response = await handler(deleteRequest("other-users-session"));

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
});
