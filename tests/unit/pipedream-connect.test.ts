import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  buildSentryManagedAuthCredentials,
  parsePipedreamManagedAuthCredentials,
  verifyPipedreamWebhookSignature,
} from "../../lib/connections/pipedream-connect";

function setPipedreamEnv() {
  process.env.PIPEDREAM_CLIENT_ID = "pd-client";
  process.env.PIPEDREAM_CLIENT_SECRET = "pd-client-credential";
  process.env.PIPEDREAM_PROJECT_ID = "proj_test";
  process.env.PIPEDREAM_PROJECT_ENVIRONMENT = "development";
  process.env.PIPEDREAM_CONNECT_WEBHOOK_SIGNING_KEY = "pd-hook-signing-key";
  process.env.PIPEDREAM_SENTRY_APP_SLUG = "sentry";
}

test("buildSentryManagedAuthCredentials stores broker metadata for Sentry", () => {
  setPipedreamEnv();
  const raw = buildSentryManagedAuthCredentials({
    id: "apn_sentry_123",
    name: "Acme Sentry",
    external_id: "user-1",
    healthy: true,
    dead: null,
    app: {
      id: "oa_sentry",
      name_slug: "sentry",
      name: "Sentry",
      auth_type: "oauth",
    },
    created_at: "2026-04-22T00:00:00.000Z",
    updated_at: "2026-04-22T01:00:00.000Z",
    authorized_scopes: ["event:read", "project:read"],
    expires_at: "2026-04-22T02:00:00.000Z",
  });

  assert.deepEqual(parsePipedreamManagedAuthCredentials(raw), {
    kind: "pipedream_connect",
    provider: "sentry",
    account_id: "apn_sentry_123",
    app_slug: "sentry",
    account_name: "Acme Sentry",
    external_user_id: "user-1",
    authorized_scopes: ["event:read", "project:read"],
    connected_at: "2026-04-22T01:00:00.000Z",
    expires_at: "2026-04-22T02:00:00.000Z",
  });
});

test("verifyPipedreamWebhookSignature accepts a valid signed payload", () => {
  setPipedreamEnv();
  const timestamp = Math.floor(Date.now() / 1000);
  const signingKey = process.env.PIPEDREAM_CONNECT_WEBHOOK_SIGNING_KEY!;
  const rawBody = JSON.stringify({
    event: "CONNECTION_SUCCESS",
    account: { id: "apn_sentry_123", external_id: "user-1" },
  });
  const signature = createHmac("sha256", signingKey)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  assert.doesNotThrow(() => {
    verifyPipedreamWebhookSignature(rawBody, `t=${timestamp},v1=${signature}`);
  });
});

test("verifyPipedreamWebhookSignature rejects a tampered payload", () => {
  setPipedreamEnv();
  const timestamp = Math.floor(Date.now() / 1000);
  const signingKey = process.env.PIPEDREAM_CONNECT_WEBHOOK_SIGNING_KEY!;
  const rawBody = JSON.stringify({
    event: "CONNECTION_SUCCESS",
    account: { id: "apn_sentry_123", external_id: "user-1" },
  });
  const signature = createHmac("sha256", signingKey)
    .update(`${timestamp}.${JSON.stringify({ ok: true })}`)
    .digest("hex");

  assert.throws(() => {
    verifyPipedreamWebhookSignature(rawBody, `t=${timestamp},v1=${signature}`);
  }, /Invalid Pipedream webhook signature/);
});
