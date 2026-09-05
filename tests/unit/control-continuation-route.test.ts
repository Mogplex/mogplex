import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createControlContinuationsHandlers } from "../../app/api/control/continuations/route";

const sessionId = "00000000-0000-4000-8000-000000000001";
function fixture(
  options: { unauthorized?: boolean; missing?: boolean; dbError?: boolean } = {}
) {
  const urls: string[] = [];
  const client = createClient("https://db.example.test", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        urls.push(url.toString());
        if (options.dbError)
          return Response.json(
            { message: "Internal database detail" },
            { status: 500 }
          );
        if (url.pathname.endsWith("control_sessions"))
          return Response.json(options.missing ? null : { id: sessionId });
        return Response.json([]);
      },
    },
  });
  return {
    ...createControlContinuationsHandlers({
      client,
      requireUserId: async () =>
        options.unauthorized
          ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
          : "owner",
    }),
    urls,
  };
}
test("follow-up routes reject unauthenticated and malformed requests before touching data", async () => {
  const f = fixture({ unauthorized: true });
  assert.equal(
    (await f.GET(new Request("https://app.test/api/control/continuations")))
      .status,
    401
  );
  assert.equal(
    (
      await f.POST(
        new Request("https://app.test/api/control/continuations", {
          method: "POST",
        })
      )
    ).status,
    401
  );
  assert.equal(f.urls.length, 0);
  const valid = fixture();
  assert.equal(
    (
      await valid.GET(
        new Request("https://app.test/api/control/continuations?sessionId=bad")
      )
    ).status,
    400
  );
  assert.equal(
    (
      await valid.POST(
        new Request("https://app.test/api/control/continuations", {
          method: "POST",
          body: JSON.stringify({ id: sessionId, action: "replay" }),
        })
      )
    ).status,
    400
  );
  assert.equal(valid.urls.length, 0);
});
test("lists only the owned mission and does not leak database failures", async () => {
  const request = () =>
    new Request(
      `https://app.test/api/control/continuations?sessionId=${sessionId}`
    );
  const f = fixture();
  assert.deepEqual(await (await f.GET(request())).json(), {
    continuations: [],
  });
  assert.ok(
    f.urls.every(
      (url) => new URL(url).searchParams.get("user_id") === "eq.owner"
    )
  );
  assert.equal((await fixture({ missing: true }).GET(request())).status, 404);
  const failed = await fixture({ dbError: true }).GET(request());
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /Internal database detail/);
});
