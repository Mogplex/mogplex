import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createControlRunPostHandler } from "../../app/api/control/runs/[runId]/route";
import { ControlRunError } from "../../lib/control/run-session";

const runId = "00000000-0000-4000-8000-000000000001";
const session = {
  id: runId,
  title: "Saved task",
  project: "acme/widgets",
  repo_id: null,
  model_id: null,
  external_run_id: runId,
  orchestration_run_id: null,
  pinned: false,
  updated_at: "2026-10-10T12:00:00Z",
  messages: [],
};
const params = { params: Promise.resolve({ runId }) };
const request = (body: unknown = {}) =>
  new Request("https://example.test/api/control/runs", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

test("run entry rejects unauthenticated and malformed requests before touching history", async () => {
  const openRun = async () => {
    throw new Error("History must not be read");
  };
  const denied = createControlRunPostHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    openRun,
  });
  assert.equal((await denied(request(), params)).status, 401);
  const authenticated = createControlRunPostHandler({
    requireUserId: async () => "owner",
    openRun,
  });
  assert.equal(
    (
      await authenticated(request(), {
        params: Promise.resolve({ runId: "bad" }),
      })
    ).status,
    400
  );
  assert.equal(
    (await authenticated(request({ continue: "yes" }), params)).status,
    400
  );
});

test("run entry returns a reusable task and preserves safe conflict errors", async () => {
  const handler = createControlRunPostHandler({
    requireUserId: async () => "owner",
    openRun: async (_user, _run, continuation) => {
      if (continuation)
        throw new ControlRunError("This run is still active", 409);
      return session;
    },
  });
  assert.deepEqual(await (await handler(request(), params)).json(), session);
  const conflict = await handler(request({ continue: true }), params);
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), {
    error: "This run is still active",
  });
});

test("unexpected run storage failures stay generic", async () => {
  const handler = createControlRunPostHandler({
    requireUserId: async () => "owner",
    openRun: async () => {
      throw new Error("private database diagnostic");
    },
  });
  const response = await handler(request(), params);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Could not open this run. Try again.",
  });
});
