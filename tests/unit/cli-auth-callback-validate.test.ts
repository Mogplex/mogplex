/* eslint-disable sonarjs/no-clear-text-protocols -- testing localhost http callbacks */
import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCliCallback,
  type ValidatedCallback,
} from "../../lib/cli-auth/callback-validate";

function isValid(
  result: ReturnType<typeof validateCliCallback>
): result is ValidatedCallback {
  return !("error" in result);
}

test("validateCliCallback accepts valid localhost http callback", () => {
  const result = validateCliCallback({
    callback: "http://localhost:8080/cb",
    nonce: "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8",
  });

  assert.ok(isValid(result));
  assert.equal(result.url, "http://localhost:8080/cb");
  assert.equal(result.port, 8080);
  assert.equal(result.nonce, "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8");
});

test("validateCliCallback accepts valid 127.0.0.1 callback", () => {
  const result = validateCliCallback({
    callback: "http://127.0.0.1:9999/callback",
    nonce: "00001111222233334444555566667777",
  });

  assert.ok(isValid(result));
  assert.equal(result.url, "http://127.0.0.1:9999/callback");
  assert.equal(result.port, 9999);
});

test("validateCliCallback accepts https callback", () => {
  const result = validateCliCallback({
    callback: "https://localhost:3000/cb",
    nonce: "abcdef0123456789abcdef0123456789",
  });

  assert.ok(isValid(result));
  assert.equal(result.url, "https://localhost:3000/cb");
});

test("validateCliCallback rejects missing callback", () => {
  const result = validateCliCallback({
    callback: null,
    nonce: "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8",
  });

  assert.ok(!isValid(result));
  assert.equal(result.error, "Missing callback parameter");
});

test("validateCliCallback rejects missing nonce", () => {
  const result = validateCliCallback({
    callback: "http://localhost:8080/cb",
    nonce: null,
  });

  assert.ok(!isValid(result));
  assert.equal(result.error, "Missing nonce parameter");
});

test("validateCliCallback rejects invalid nonce format - too short", () => {
  const result = validateCliCallback({
    callback: "http://localhost:8080/cb",
    nonce: "abc123",
  });

  assert.ok(!isValid(result));
  assert.ok(result.error.includes("32 hex characters"));
});

test("validateCliCallback rejects invalid nonce format - non-hex", () => {
  const result = validateCliCallback({
    callback: "http://localhost:8080/cb",
    nonce: "ghijklmnopqrstuvghijklmnopqrstuv",
  });

  assert.ok(!isValid(result));
  assert.ok(result.error.includes("32 hex characters"));
});

test("validateCliCallback rejects non-localhost host", () => {
  const result = validateCliCallback({
    callback: "http://example.com:8080/cb",
    nonce: "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8",
  });

  assert.ok(!isValid(result));
  assert.ok(result.error.includes("localhost"));
});

test("validateCliCallback rejects callback without port", () => {
  const result = validateCliCallback({
    callback: "http://localhost/cb",
    nonce: "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8",
  });

  assert.ok(!isValid(result));
  assert.ok(result.error.includes("port"));
});

test("validateCliCallback rejects port below 1024", () => {
  // Port 80 is the default for http, so URL parser normalizes it to empty string
  // This means it fails with "must include a port number"
  const result = validateCliCallback({
    callback: "http://localhost:80/cb",
    nonce: "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8",
  });

  assert.ok(!isValid(result));
  assert.ok(result.error.includes("port"));
});

test("validateCliCallback rejects explicit low port", () => {
  // Port 443 is explicit in https URLs
  const result = validateCliCallback({
    callback: "http://localhost:443/cb",
    nonce: "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8",
  });

  assert.ok(!isValid(result));
  assert.ok(result.error.includes("1024"));
});

test("validateCliCallback rejects port above 65535", () => {
  // Ports above 65535 are rejected by URL parser as invalid
  const result = validateCliCallback({
    callback: "http://localhost:70000/cb",
    nonce: "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8",
  });

  assert.ok(!isValid(result));
  assert.equal(result.error, "Invalid callback URL");
});

test("validateCliCallback rejects invalid protocol", () => {
  const result = validateCliCallback({
    callback: "ftp://localhost:8080/cb",
    nonce: "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8",
  });

  assert.ok(!isValid(result));
  assert.ok(result.error.includes("http"));
});

test("validateCliCallback rejects invalid URL", () => {
  const result = validateCliCallback({
    callback: "not-a-url",
    nonce: "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8",
  });

  assert.ok(!isValid(result));
  assert.equal(result.error, "Invalid callback URL");
});

test("validateCliCallback preserves query string in callback URL", () => {
  const result = validateCliCallback({
    callback: "http://localhost:8080/cb?state=abc",
    nonce: "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8",
  });

  assert.ok(isValid(result));
  assert.equal(result.url, "http://localhost:8080/cb?state=abc");
});

test("validateCliCallback accepts uppercase hex in nonce", () => {
  const result = validateCliCallback({
    callback: "http://localhost:8080/cb",
    nonce: "A1B2C3D4E5F6A7B8A1B2C3D4E5F6A7B8",
  });

  assert.ok(isValid(result));
  assert.equal(result.nonce, "A1B2C3D4E5F6A7B8A1B2C3D4E5F6A7B8");
});

test("validateCliCallback handles edge case port 1024", () => {
  const result = validateCliCallback({
    callback: "http://localhost:1024/cb",
    nonce: "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8",
  });

  assert.ok(isValid(result));
  assert.equal(result.port, 1024);
});

test("validateCliCallback handles edge case port 65535", () => {
  const result = validateCliCallback({
    callback: "http://localhost:65535/cb",
    nonce: "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8",
  });

  assert.ok(isValid(result));
  assert.equal(result.port, 65535);
});
