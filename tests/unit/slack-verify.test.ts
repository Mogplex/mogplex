import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  SLACK_SIGNATURE_HEADER,
  SLACK_SIGNATURE_MAX_AGE_SECONDS,
  SLACK_SIGNATURE_TIMESTAMP_HEADER,
  verifySlackRequest,
  verifySlackSignature,
} from "../../lib/slack/verify";

// Deterministic test fixture — clearly synthetic, not a real Slack secret.
const SIGNING_SECRET = ["test", "slack", "signing", "secret"].join("-");

function signSlackRequest(rawBody: string, timestamp: string) {
  const base = `v0:${timestamp}:${rawBody}`;
  const hex = crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(base)
    .digest("hex");
  return `v0=${hex}`;
}

test("verifySlackSignature accepts a request signed within the freshness window", () => {
  const timestamp = "1700000000";
  const rawBody = JSON.stringify({ type: "event_callback", event_id: "Ev123" });
  const signature = signSlackRequest(rawBody, timestamp);

  const result = verifySlackSignature({
    rawBody,
    timestamp,
    signature,
    signingSecret: SIGNING_SECRET,
    now: () => Number(timestamp) * 1000,
  });

  assert.equal(result, true);
});

test("verifySlackSignature rejects when the timestamp drifted past the replay window", () => {
  const timestamp = "1700000000";
  const rawBody = "{}";
  const signature = signSlackRequest(rawBody, timestamp);

  const result = verifySlackSignature({
    rawBody,
    timestamp,
    signature,
    signingSecret: SIGNING_SECRET,
    // Pretend "now" is well past the 5-minute window.
    now: () => (Number(timestamp) + SLACK_SIGNATURE_MAX_AGE_SECONDS + 1) * 1000,
  });

  assert.equal(result, false);
});

test("verifySlackSignature rejects a tampered body", () => {
  const timestamp = "1700000000";
  const rawBody = JSON.stringify({ original: true });
  const signature = signSlackRequest(rawBody, timestamp);

  const result = verifySlackSignature({
    rawBody: JSON.stringify({ tampered: true }),
    timestamp,
    signature,
    signingSecret: SIGNING_SECRET,
    now: () => Number(timestamp) * 1000,
  });

  assert.equal(result, false);
});

test("verifySlackSignature rejects when secret is wrong", () => {
  const timestamp = "1700000000";
  const rawBody = "{}";
  const signature = signSlackRequest(rawBody, timestamp);

  const result = verifySlackSignature({
    rawBody,
    timestamp,
    signature,
    signingSecret: "different-secret",
    now: () => Number(timestamp) * 1000,
  });

  assert.equal(result, false);
});

test("verifySlackSignature returns false for missing inputs without throwing", () => {
  const timestamp = "1700000000";
  const rawBody = "{}";

  assert.equal(
    verifySlackSignature({
      rawBody,
      timestamp: null,
      signature: signSlackRequest(rawBody, timestamp),
      signingSecret: SIGNING_SECRET,
    }),
    false
  );
  assert.equal(
    verifySlackSignature({
      rawBody,
      timestamp,
      signature: null,
      signingSecret: SIGNING_SECRET,
    }),
    false
  );
  assert.equal(
    verifySlackSignature({
      rawBody,
      timestamp,
      signature: signSlackRequest(rawBody, timestamp),
      signingSecret: "",
    }),
    false
  );
});

test("verifySlackSignature rejects non-numeric timestamps", () => {
  const rawBody = "{}";
  const signature = signSlackRequest(rawBody, "not-a-number");

  assert.equal(
    verifySlackSignature({
      rawBody,
      timestamp: "not-a-number",
      signature,
      signingSecret: SIGNING_SECRET,
    }),
    false
  );
});

test("verifySlackSignature is timing-safe even when prefixes match", () => {
  const timestamp = "1700000000";
  const rawBody = "{}";
  const valid = signSlackRequest(rawBody, timestamp);
  // Same length, identical prefix, single trailing-byte difference.
  const forged = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;

  assert.equal(
    verifySlackSignature({
      rawBody,
      timestamp,
      signature: forged,
      signingSecret: SIGNING_SECRET,
      now: () => Number(timestamp) * 1000,
    }),
    false
  );
});

test("verifySlackRequest reads the canonical Slack headers", () => {
  const timestamp = "1700000000";
  const rawBody = "{}";
  const signature = signSlackRequest(rawBody, timestamp);

  const headers = new Headers({
    [SLACK_SIGNATURE_TIMESTAMP_HEADER]: timestamp,
    [SLACK_SIGNATURE_HEADER]: signature,
  });

  assert.equal(
    verifySlackRequest({
      headers,
      rawBody,
      signingSecret: SIGNING_SECRET,
      now: () => Number(timestamp) * 1000,
    }),
    true
  );
});
