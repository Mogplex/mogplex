import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCliAuthReturnUrl,
  firstOf,
  resolveCliTokenName,
} from "../../lib/cli-auth/page-params";

test("firstOf returns the first query param value", () => {
  assert.equal(firstOf(["first", "second"]), "first");
  assert.equal(firstOf("value"), "value");
  assert.equal(firstOf(undefined), null);
});

test("buildCliAuthReturnUrl keeps the supported cli-auth params", () => {
  const returnUrl = buildCliAuthReturnUrl({
    callback: "http://localhost:45454/callback",
    name: "CLI on 100% host",
    nonce: "abc123",
    ignored: "nope",
  });

  assert.equal(
    returnUrl,
    "/cli-auth?callback=http%3A%2F%2Flocalhost%3A45454%2Fcallback&name=CLI+on+100%25+host&nonce=abc123"
  );
});

test("resolveCliTokenName preserves literal percent signs without decoding", () => {
  assert.equal(resolveCliTokenName("CLI on 100% host"), "CLI on 100% host");
});

test("resolveCliTokenName trims, caps, and falls back to the default label", () => {
  assert.equal(resolveCliTokenName(`  ${"x".repeat(120)}  `), "x".repeat(100));

  assert.equal(
    resolveCliTokenName("   ", new Date("2026-04-18T12:00:00.000Z")),
    "CLI on 2026-04-18"
  );
});
