import assert from "node:assert/strict";
import test from "node:test";
import {
  SIGNING_SECRET,
  loadSlackWebhookRoute,
  signedHeaders,
} from "./helpers/slack-webhook-route-fixtures";

test("rejects requests with an invalid signature", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();

  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
  });

  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": Math.floor(Date.now() / 1000).toString(),
        "x-slack-signature": "v0=deadbeef",
      },
    })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Invalid signature" });
});

test("returns 503 when the signing secret is not configured", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();

  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => null,
  });

  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: "{}",
    })
  );

  assert.equal(response.status, 503);
});

test("echoes the challenge for url_verification handshakes", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();

  const body = JSON.stringify({
    type: "url_verification",
    challenge: "challenge-token-abc",
  });

  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
  });

  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body,
      headers: {
        ...signedHeaders(body),
        "content-type": "application/json",
      },
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { challenge: "challenge-token-abc" });
});

test("rejects oversized payloads before parsing", async () => {
  const { createSlackWebhookPostHandler, SLACK_WEBHOOK_MAX_BODY_BYTES } =
    await loadSlackWebhookRoute();

  const huge = "a".repeat(SLACK_WEBHOOK_MAX_BODY_BYTES + 1);

  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
  });

  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: huge,
      headers: {
        "x-slack-request-timestamp": Math.floor(Date.now() / 1000).toString(),
        "x-slack-signature": "v0=ignored",
        "content-type": "application/json",
      },
    })
  );

  assert.equal(response.status, 413);
});

test("rejects payloads that exceed the byte limit with multibyte text", async () => {
  const { createSlackWebhookPostHandler, SLACK_WEBHOOK_MAX_BODY_BYTES } =
    await loadSlackWebhookRoute();

  const huge = "€".repeat(Math.floor(SLACK_WEBHOOK_MAX_BODY_BYTES / 3) + 1);
  assert.ok(huge.length < SLACK_WEBHOOK_MAX_BODY_BYTES);
  assert.ok(Buffer.byteLength(huge, "utf8") > SLACK_WEBHOOK_MAX_BODY_BYTES);

  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
  });

  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: huge,
      headers: {
        "x-slack-request-timestamp": Math.floor(Date.now() / 1000).toString(),
        "x-slack-signature": "v0=ignored",
        "content-type": "application/json",
      },
    })
  );

  assert.equal(response.status, 413);
});
