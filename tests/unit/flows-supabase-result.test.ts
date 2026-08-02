import assert from "node:assert/strict";
import test from "node:test";
import {
  unwrapOrThrow,
  unwrapRowsOrThrow,
} from "../../lib/flows/supabase-result";

test("unwrapOrThrow returns the payload when there is no error", () => {
  assert.deepEqual(unwrapOrThrow({ data: { id: "flow-1" }, error: null }), {
    id: "flow-1",
  });
});

test("unwrapOrThrow throws the Supabase error message", () => {
  assert.throws(
    () =>
      unwrapOrThrow({ data: null, error: { message: "permission denied" } }),
    /permission denied/
  );
});

test("unwrapOrThrow passes a null payload straight through", () => {
  // A single-row query that matched nothing is not an error, so callers still
  // have to null-check. Narrowing null away here would hide that from them.
  assert.equal(unwrapOrThrow({ data: null, error: null }), null);
});

test("unwrapRowsOrThrow normalizes a null payload to an empty array", () => {
  assert.deepEqual(unwrapRowsOrThrow({ data: null, error: null }), []);
});

test("unwrapRowsOrThrow returns rows untouched", () => {
  const rows = [{ id: "run-1" }, { id: "run-2" }];
  assert.deepEqual(unwrapRowsOrThrow({ data: rows, error: null }), rows);
});

test("unwrapRowsOrThrow throws before it reaches the null normalization", () => {
  assert.throws(
    () => unwrapRowsOrThrow({ data: null, error: { message: "timeout" } }),
    /timeout/
  );
});
