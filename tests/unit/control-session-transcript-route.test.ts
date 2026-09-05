import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";
import { NextResponse } from "next/server";
import { createControlSessionsPutHandler } from "../../app/api/control/sessions/route";

const message = (id: string, text: string): UIMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
});
function fixture(
  options: {
    unauthorized?: boolean;
    missing?: boolean;
    archived?: boolean;
    conflict?: boolean;
  } = {}
) {
  const urls: string[] = [];
  let messages = [
    message("old", "Original reply"),
    message("server", "Worker finished"),
  ];
  const client = createClient("https://db.example.test", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        urls.push(url.toString());
        if (url.searchParams.get("user_id") !== "eq.owner" || options.missing)
          return Response.json(null);
        if (init?.method === "PATCH") {
          if (options.conflict) return Response.json(null);
          const body = JSON.parse(String(init.body));
          messages = body.messages;
        }
        return Response.json({
          id: "session",
          user_id: "owner",
          messages,
          archived: options.archived ?? false,
          updated_at: "revision-2",
        });
      },
    },
  });
  const handler = createControlSessionsPutHandler({
    requireUserId: async () =>
      options.unauthorized
        ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        : "owner",
    client,
  });
  return { handler, urls, messages: () => messages };
}
function request(body: unknown) {
  return new Request("https://mogplex.example/api/control/sessions", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

test("stale browser saves preserve the server reply and only add unseen messages", async () => {
  const f = fixture();
  const res = await f.handler(
    request({
      id: "session",
      expected_updated_at: "revision-2",
      messages: [
        message("old", "stale replacement"),
        message("local", "Local reply"),
      ],
    })
  );
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).session.messages, [
    message("old", "Original reply"),
    message("server", "Worker finished"),
    message("local", "Local reply"),
  ]);
  assert.ok(
    f.urls.every(
      (url) => new URL(url).searchParams.get("user_id") === "eq.owner"
    )
  );
  assert.ok(
    f.urls.some(
      (url) => new URL(url).searchParams.get("updated_at") === "eq.revision-2"
    )
  );
});

test("transcript updates enforce authentication, validate input, and do not revive absent or archived sessions", async () => {
  const denied = fixture({ unauthorized: true });
  assert.equal((await denied.handler(request({}))).status, 401);
  assert.equal(denied.urls.length, 0);
  for (const body of [
    null,
    [],
    {},
    { id: "session" },
    {
      id: "session",
      expected_updated_at: "revision",
      messages: [
        { id: "a", role: "assistant", parts: [{ type: "dynamic-tool" }] },
      ],
    },
  ]) {
    assert.equal((await fixture().handler(request(body))).status, 400);
  }
  for (const options of [
    { missing: true },
    { archived: true },
    { conflict: true },
  ]) {
    const f = fixture(options);
    assert.equal(
      (
        await f.handler(
          request({
            id: "session",
            expected_updated_at: "revision",
            messages: [message("local", "must not overwrite")],
          })
        )
      ).status,
      409
    );
    assert.equal(
      f.messages().some((item) => item.id === "local"),
      false
    );
  }
});
