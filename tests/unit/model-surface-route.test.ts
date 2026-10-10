import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createModelTargetsPatchHandler } from "../../app/api/settings/model-targets/route";

test("surface model updates authenticate and validate before storage access", async () => {
  const request = (body: string) =>
    new Request("http://localhost/api/settings/model-targets", {
      method: "PATCH",
      body,
    });
  const denied = createModelTargetsPatchHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
  assert.equal((await denied(request("{}"))).status, 401);
  const patch = createModelTargetsPatchHandler({
    requireUserId: async () => "user",
  });
  for (const body of [
    "bad json",
    "null",
    "[]",
    "{}",
    ...[
      { surface: "unknown", model: null },
      { surface: "chat" },
      { surface: "chat", model: "" },
      { surface: "chat", model: 1 },
    ].map((value) => JSON.stringify(value)),
  ]) {
    assert.equal((await patch(request(body))).status, 400);
  }
});
