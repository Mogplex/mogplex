import assert from "node:assert/strict";
import { test } from "node:test";
import { NextResponse } from "next/server";
import { createControlTurnsHandler } from "../../app/api/control/turns/route";
import { supabaseAdmin } from "../../lib/supabase/admin";
import { queueControlTurn } from "../../lib/control/turn-dispatch";

test("a mission hint cannot enqueue a run without an authenticated conversation identity", async () => {
  await assert.rejects(
    queueControlTurn({
      req: new Request("https://app.test/api/control/chat"),
      userId: "owner",
      body: { messages: [], missionId: "00000000-0000-4000-8000-000000000003" },
      resolvedModel: "fixture/model",
      limitClaimId: null,
      callStartedAt: new Date().toISOString(),
      infrastructureDiagnosticScope: [],
      latestUserText: "Run checks",
    }),
    /Save this Control conversation/
  );
});

test("turn observation rejects unauthenticated and malformed requests before querying", async () => {
  const unauthorized = createControlTurnsHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    client: supabaseAdmin,
  });
  assert.equal(
    (await unauthorized(new Request("https://app.test/api/control/turns")))
      .status,
    401
  );
  const owned = createControlTurnsHandler({
    requireUserId: async () => "owner",
    client: supabaseAdmin,
  });
  assert.equal(
    (
      await owned(
        new Request("https://app.test/api/control/turns?sessionId=invalid")
      )
    ).status,
    400
  );
});
