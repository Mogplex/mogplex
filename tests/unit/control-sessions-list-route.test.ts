import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createControlSessionsGetHandler } from "../../app/api/control/sessions/route";

function fixture(unauthorized = false, failed = false) {
  const client = createClient("https://db.example.test", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        if (failed)
          return Response.json(
            { message: "Database unavailable" },
            { status: 500 }
          );
        const url = new URL(String(input));
        if (url.searchParams.get("user_id") !== "eq.owner")
          return Response.json([]);
        return Response.json([
          {
            id:
              url.searchParams.get("archived") === "eq.true"
                ? "archived-chat"
                : "active-chat",
          },
        ]);
      },
    },
  });
  return createControlSessionsGetHandler({
    client,
    requireUserId: async () =>
      unauthorized
        ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        : "owner",
  });
}

test("session lists default to active and allow the authenticated user's archive", async () => {
  const handler = fixture();
  assert.deepEqual(
    await (
      await handler(new Request("https://app.test/api/control/sessions"))
    ).json(),
    [{ id: "active-chat" }]
  );
  assert.deepEqual(
    await (
      await handler(
        new Request("https://app.test/api/control/sessions?archived=true")
      )
    ).json(),
    [{ id: "archived-chat" }]
  );
});

test("session lists reject unauthorized access and invalid archive or page options", async () => {
  assert.equal(
    (
      await fixture(true)(
        new Request("https://app.test/api/control/sessions?archived=true")
      )
    ).status,
    401
  );
  for (const query of [
    "archived=all",
    "offset=-1",
    "offset=1.5",
    "offset=nope",
  ]) {
    assert.equal(
      (
        await fixture()(
          new Request(`https://app.test/api/control/sessions?${query}`)
        )
      ).status,
      400
    );
  }
  assert.equal(
    (
      await fixture(
        false,
        true
      )(new Request("https://app.test/api/control/sessions?archived=true"))
    ).status,
    500
  );
});
