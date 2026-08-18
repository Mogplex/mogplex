import assert from "node:assert/strict";
import test from "node:test";
import {
  redactSecretsInText,
  sanitizeTelemetryRecord,
  sanitizeTelemetryValue,
} from "../../lib/ai-telemetry";

test("sanitizeTelemetryRecord redacts nested secret-bearing keys and JSON string bodies", () => {
  const sanitized = sanitizeTelemetryRecord({
    authorization: "Bearer top-secret-token",
    nested: {
      access_token: "abc123",
      safe: "ok",
    },
    body: JSON.stringify({
      token: "body-secret",
      nested: {
        api_key: "nested-secret",
      },
      safe: "visible",
    }),
  });

  assert.equal(sanitized.authorization, "[redacted]");
  assert.deepEqual(sanitized.nested, {
    access_token: "[redacted]",
    safe: "ok",
  });
  assert.equal(typeof sanitized.body, "string");
  assert.match(String(sanitized.body), /\[redacted]/);
  assert.doesNotMatch(String(sanitized.body), /body-secret|nested-secret/);
  assert.match(String(sanitized.body), /visible/);
});

test("sanitizeTelemetryValue redacts bearer and common token formats inside raw strings", () => {
  const sanitized = sanitizeTelemetryValue(
    "Authorization: Bearer top-secret gho_1234567890 sk-secret-key x-access-token:secret-value@github.com"
  );

  assert.equal(typeof sanitized, "string");
  assert.doesNotMatch(
    String(sanitized),
    /top-secret|gho_1234567890|sk-secret-key|secret-value/
  );
  assert.match(String(sanitized), /Bearer \[redacted]/);
  assert.match(String(sanitized), /\[redacted]/);
});

test("redactSecretsInText removes installation tokens and git credential URLs", () => {
  const sanitized = redactSecretsInText(
    "ghs_installationToken123 https://x-access-token:token-value@github.com"
  );

  assert.doesNotMatch(sanitized, /installationToken123|token-value/);
  assert.match(sanitized, /redacted/);
});
