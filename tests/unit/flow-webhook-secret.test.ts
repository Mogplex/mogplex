import assert from "node:assert/strict";
import test from "node:test";
import {
  generateFlowWebhookSecret,
  signFlowWebhookPayload,
  verifyFlowWebhookSignature,
} from "../../lib/flows/webhook-secret";

test("flow webhook signing uses a timing-safe sha256 envelope", () => {
  const body = JSON.stringify({ hello: "world" });
  const secret = "whsec_fixture";
  const signature = signFlowWebhookPayload(body, secret);

  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  assert.equal(
    verifyFlowWebhookSignature({ rawBody: body, secret, signature }),
    true
  );
  assert.equal(
    verifyFlowWebhookSignature({
      rawBody: `${body} `,
      secret,
      signature,
    }),
    false
  );
});

test("generated flow webhook secrets are high-entropy and prefixed", () => {
  const first = generateFlowWebhookSecret();
  const second = generateFlowWebhookSecret();
  assert.match(first, /^whsec_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});
