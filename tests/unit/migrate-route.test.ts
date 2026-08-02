import assert from "node:assert/strict";
import test from "node:test";

async function loadMigrateRoute() {
  return import("../../app/api/migrate/route");
}

test("POST /api/migrate is disabled", async () => {
  const { POST } = await loadMigrateRoute();

  const response = await POST();

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
});
