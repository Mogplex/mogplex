import assert from "node:assert/strict";
import test from "node:test";
import { ensureUserId } from "../../lib/auth";

test("ensureUserId returns the user id when present", () => {
  assert.equal(ensureUserId("user-123"), "user-123");
});

test("ensureUserId returns a standard unauthorized json response when missing", async () => {
  const response = ensureUserId(undefined);

  assert.ok(response instanceof Response);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});
