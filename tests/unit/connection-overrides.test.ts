import assert from "node:assert/strict";
import test from "node:test";
import { patchOverrides } from "../../lib/connections/overrides";
import type { ConnectionOverride } from "../../lib/types";

const REPO_ID = "repo-1";
const CONN_ID = "conn-1";

function override(
  overrides: Partial<ConnectionOverride> = {}
): ConnectionOverride {
  return {
    id: "override-1",
    repo_id: REPO_ID,
    connection_id: CONN_ID,
    excluded: true,
    created_at: "2026-04-17T00:00:00.000Z",
    ...overrides,
  };
}

test("patchOverrides: adds a new exclusion when none exists", () => {
  const result = patchOverrides([], REPO_ID, CONN_ID, true);
  assert.equal(result.length, 1);
  assert.equal(result[0].connection_id, CONN_ID);
  assert.equal(result[0].repo_id, REPO_ID);
  assert.equal(result[0].excluded, true);
  assert.equal(result[0].id, `optimistic-${CONN_ID}`);
});

test("patchOverrides: preserves unrelated overrides when adding", () => {
  const other = override({ id: "other", connection_id: "conn-2" });
  const result = patchOverrides([other], REPO_ID, CONN_ID, true);
  assert.equal(result.length, 2);
  assert.ok(result.some((o) => o.connection_id === "conn-2"));
  assert.ok(result.some((o) => o.connection_id === CONN_ID));
});

test("patchOverrides: flips an existing override to excluded=true in place", () => {
  const existing = override({ excluded: false });
  const result = patchOverrides([existing], REPO_ID, CONN_ID, true);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, existing.id);
  assert.equal(result[0].excluded, true);
});

test("patchOverrides: removes an existing exclusion when including", () => {
  const existing = override({ excluded: true });
  const result = patchOverrides([existing], REPO_ID, CONN_ID, false);
  assert.deepEqual(result, []);
});

test("patchOverrides: include is a no-op when no override exists", () => {
  const other = override({ id: "other", connection_id: "conn-2" });
  const result = patchOverrides([other], REPO_ID, CONN_ID, false);
  assert.equal(result.length, 1);
  assert.equal(result[0].connection_id, "conn-2");
});

test("patchOverrides: does not mutate the input array", () => {
  const input: ConnectionOverride[] = [override({ excluded: false })];
  const snapshot = JSON.parse(JSON.stringify(input));
  patchOverrides(input, REPO_ID, CONN_ID, true);
  assert.deepEqual(input, snapshot);
});
