import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../../proxy";

// NOTE: Next.js compiles `config.matcher` entries through path-to-regexp at
// runtime, not raw `RegExp`. For the current negative-lookahead pattern the
// two engines agree, so a JS-regex sanity check is informative; but any
// future change to the matcher string that relies on path-to-regexp syntax
// (named params, wildcards, etc.) must be validated against an actual Next
// instance — the literal-string snapshot in proxy.test.ts is the ground
// truth, this file is a behavioural approximation.
const [matcherPattern] = config.matcher;
const matcher = new RegExp(`^${matcherPattern}$`);

test("proxy matcher skips /fonts/* so @font-face requests aren't auth-gated", () => {
  assert.equal(matcher.test("/fonts/mondwest/PPMondwest-Regular.woff2"), false);
  assert.equal(matcher.test("/fonts/mondwest/PPMondwest-Bold.woff"), false);
  assert.equal(matcher.test("/fonts/inter/Inter.ttf"), false);
});

test("proxy matcher still proxies non-/fonts requests even when they end in a font extension", () => {
  // Path-based (not extension-based) exemption keeps the bypass surface tight:
  // a crafted /api/* path ending in .woff must still hit the proxy.
  assert.equal(matcher.test("/api/foo.woff2"), true);
  assert.equal(matcher.test("/api/skills/registry/x.woff"), true);
  assert.equal(matcher.test("/some-team/repo.ttf"), true);
});

test("proxy matcher still skips image and Next internals it already excluded", () => {
  assert.equal(matcher.test("/_next/static/chunks/main.js"), false);
  assert.equal(matcher.test("/_next/image"), false);
  assert.equal(matcher.test("/favicon.ico"), false);
  assert.equal(matcher.test("/opengraph-image.png"), false);
  assert.equal(matcher.test("/icon.svg"), false);
});

test("proxy matcher continues to cover app routes and APIs", () => {
  assert.equal(matcher.test("/"), true);
  assert.equal(matcher.test("/login"), true);
  assert.equal(matcher.test("/some-team/repo"), true);
  assert.equal(matcher.test("/api/auth/session"), true);
});
