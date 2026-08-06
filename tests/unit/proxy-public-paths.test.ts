import assert from "node:assert/strict";
import test from "node:test";
import { isPublicRoutePath } from "../../lib/auth-route-policy";

test("isPublicRoutePath exact-matches script endpoints", () => {
  assert.equal(isPublicRoutePath("/install.sh"), true);
  assert.equal(isPublicRoutePath("/install.ps1"), true);
});

test("isPublicRoutePath allows the public homepage", () => {
  assert.equal(isPublicRoutePath("/"), true);
});

test("isPublicRoutePath exact-matches metadata files", () => {
  assert.equal(isPublicRoutePath("/robots.txt"), true);
  assert.equal(isPublicRoutePath("/robots.txt/more"), false);
  assert.equal(isPublicRoutePath("/sitemap.xml"), true);
  assert.equal(isPublicRoutePath("/sitemap.xml/more"), false);
  assert.equal(isPublicRoutePath("/manifest.webmanifest"), true);
  assert.equal(isPublicRoutePath("/manifest.webmanifest/more"), false);
});

test("isPublicRoutePath exact-matches /api/cli/latest", () => {
  assert.equal(isPublicRoutePath("/api/cli/latest"), true);
});

test("isPublicRoutePath does not leak past path boundaries", () => {
  // startsWith would have let these through; the new matcher must not.
  assert.equal(isPublicRoutePath("/api/cli/latest-beta"), false);
  assert.equal(isPublicRoutePath("/api/cli/latestv2"), false);
  assert.equal(isPublicRoutePath("/install.shXXX"), false);
  assert.equal(isPublicRoutePath("/install.ps1.bak"), false);
  assert.equal(isPublicRoutePath("/loginfoo"), false);
  assert.equal(isPublicRoutePath("/privacy-policy"), false);
});

test("isPublicRoutePath allows child paths of exact-match entries", () => {
  // Exact-match entries should still cover their child paths so sub-resources
  // keep working (e.g. a hypothetical /login/callback, /api/cli/latest/foo).
  assert.equal(isPublicRoutePath("/login/callback"), true);
  assert.equal(isPublicRoutePath("/api/cli/latest/assets"), true);
});

test("isPublicRoutePath still treats trailing-slash entries as prefix matches", () => {
  assert.equal(isPublicRoutePath("/api/auth/session"), true);
  assert.equal(isPublicRoutePath("/api/webhooks/stripe"), true);
});

test("isPublicRoutePath rejects unrelated app paths", () => {
  assert.equal(isPublicRoutePath("/dashboard"), false);
  assert.equal(isPublicRoutePath("/api/agents"), false);
});

test("isPublicRoutePath preserves legacy bare-entry behavior at path boundaries", () => {
  // Each legacy entry: exact match and child-path match must pass;
  // sibling-prefix match (the original startsWith bug) must not.
  const cases: Array<[string, boolean, string]> = [
    ["/login", true, "exact"],
    ["/login/callback", true, "child"],
    ["/loginfoo", false, "sibling"],
    ["/auth/callback", true, "exact"],
    ["/auth/callback/foo", true, "child"],
    ["/auth/callbackXXX", false, "sibling"],
    ["/auth/error", true, "exact"],
    ["/auth/error-page", false, "sibling"],
    ["/privacy", true, "exact"],
    ["/privacy-policy", false, "sibling"],
    ["/terms", true, "exact"],
    ["/terms-of-service", false, "sibling"],
    ["/conduct", true, "exact"],
    ["/conduct-report", false, "sibling"],
  ];
  for (const [input, expected, kind] of cases) {
    assert.equal(
      isPublicRoutePath(input),
      expected,
      `${kind} "${input}" should be ${expected}`
    );
  }
});
