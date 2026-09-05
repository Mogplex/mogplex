import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { loadObservabilityCallsRoute } from "./helpers/observability-calls-route-fixtures";

for (const query of [
  "call_ids=00000000-0000-4000-8000-000000000001",
  "conversation_id=conversation&call_ids=bad-id",
  "conversation_id=conversation&call_ids=",
  `conversation_id=conversation&call_ids=${Array.from({ length: 101 }, () => "00000000-0000-4000-8000-000000000001").join(",")}`,
]) {
  test(`rejects invalid exact call lookup (${query.length} chars) before querying`, async () => {
    const { createObservabilityCallsGetHandler } =
      await loadObservabilityCallsRoute();
    const handler = createObservabilityCallsGetHandler({
      requireUserId: async () => "owner",
      buildQuery: () => {
        throw new Error("must not reach database");
      },
    });
    const response = await handler(
      new NextRequest(`http://localhost/api/observability/calls?${query}`)
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /call_ids requires/);
  });
}

test("exact call lookup preserves the authentication gate", async () => {
  const { createObservabilityCallsGetHandler } =
    await loadObservabilityCallsRoute();
  const handler = createObservabilityCallsGetHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    buildQuery: () => {
      throw new Error("must not reach database");
    },
  });
  const response = await handler(
    new NextRequest(
      "http://localhost/api/observability/calls?conversation_id=conversation&call_ids=00000000-0000-4000-8000-000000000001"
    )
  );
  assert.equal(response.status, 401);
});
