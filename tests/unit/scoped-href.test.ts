import assert from "node:assert/strict";
import test from "node:test";
import { scopedHref } from "../../lib/scoped-href";

test("scopedHref prepends the scope to an absolute path", () => {
  assert.equal(
    scopedHref("acme", "/projects/workspace"),
    "/acme/projects/workspace"
  );
});

test("scopedHref tolerates a relative path by inserting the leading slash", () => {
  assert.equal(scopedHref("acme", "settings"), "/acme/settings");
});

test("scopedHref throws when scope is undefined", () => {
  assert.throws(
    () => scopedHref(undefined, "/projects/workspace"),
    /scope is required/
  );
});

test("scopedHref throws when scope is the empty string", () => {
  assert.throws(() => scopedHref("", "/settings"), /scope is required/);
});
