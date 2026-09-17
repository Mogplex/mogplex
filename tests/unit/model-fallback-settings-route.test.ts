import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createModelFallbackHandlers } from "../../app/api/settings/model-fallbacks/route";

test("fallback settings reject a fifth choice before database access", async () => {
  const { PATCH } = createModelFallbackHandlers({
    requireUserId: async () => "owner",
  });
  const response = await PATCH(
    new Request("https://example.test", {
      method: "PATCH",
      body: JSON.stringify({
        fallback_model_ids: [
          "lab/one",
          "lab/two",
          "lab/three",
          "lab/four",
          "lab/five",
        ],
      }),
    })
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Choose up to 4 fallback models",
  });
});

test("fallback settings require authentication for reads and writes", async () => {
  const handlers = createModelFallbackHandlers({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
  assert.equal((await handlers.GET()).status, 401);
  assert.equal(
    (
      await handlers.PATCH(
        new Request("https://example.test", { method: "PATCH" })
      )
    ).status,
    401
  );
});

test("fallback settings reject malformed requests before any database access", async () => {
  const { PATCH } = createModelFallbackHandlers({
    requireUserId: async () => "owner",
  });
  for (const body of [
    "not json",
    "null",
    "{}",
    '{"fallback_model_ids":[null]}',
  ]) {
    const response = await PATCH(
      new Request("https://example.test", { method: "PATCH", body })
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Choose different gateway models",
    });
  }
});
