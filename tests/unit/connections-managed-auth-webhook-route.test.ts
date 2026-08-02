import assert from "node:assert/strict";
import test from "node:test";
import { PipedreamConnectConfigError } from "../../lib/connections/pipedream-connect";

async function loadManagedAuthWebhookRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.PIPEDREAM_PROJECT_ENVIRONMENT ||= "development";
  process.env.PIPEDREAM_CLIENT_ID ||= "pd-client";
  process.env.PIPEDREAM_CLIENT_SECRET ||= "pd-secret";
  process.env.PIPEDREAM_PROJECT_ID ||= "proj_test";
  process.env.PIPEDREAM_CONNECT_WEBHOOK_SIGNING_KEY ||= "pd-webhook-secret";
  return import("../../app/api/connections/managed-auth/webhook/route");
}

test("managed auth webhook rejects oversized payloads before signature verification", async () => {
  const {
    MANAGED_AUTH_WEBHOOK_MAX_BODY_BYTES,
    createManagedAuthWebhookPostHandler,
  } = await loadManagedAuthWebhookRoute();
  let verified = false;

  const handler = createManagedAuthWebhookPostHandler({
    verifyPipedreamWebhookSignature: () => {
      verified = true;
    },
  });

  const response = await handler(
    new Request("http://localhost/api/connections/managed-auth/webhook", {
      method: "POST",
      body: "x".repeat(MANAGED_AUTH_WEBHOOK_MAX_BODY_BYTES + 1),
    })
  );

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Payload too large" });
  assert.equal(verified, false);
});

test("managed auth webhook rejects mismatched account external users", async () => {
  const { createManagedAuthWebhookPostHandler } =
    await loadManagedAuthWebhookRoute();

  const handler = createManagedAuthWebhookPostHandler({
    verifyPipedreamWebhookSignature: () => {},
    parsePipedreamConnectionWebhookPayload: () =>
      ({
        event: "CONNECTION_SUCCESS",
        connect_token: "tok_123",
        connect_session_id: 1,
        environment: "development",
        account: {
          id: "apn_sentry_123",
          external_id: "payload-user",
          healthy: true,
          dead: null,
          app: { name_slug: "sentry", name: "Sentry", auth_type: "oauth" },
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-23T00:00:00.000Z",
        },
      }) as const,
    retrievePipedreamAccount: async () =>
      ({
        id: "apn_sentry_123",
        name: "Acme Sentry",
        external_id: "canonical-user",
        healthy: true,
        dead: null,
        app: { name_slug: "sentry", name: "Sentry", auth_type: "oauth" },
        created_at: "2026-04-23T00:00:00.000Z",
        updated_at: "2026-04-23T00:00:00.000Z",
      }) as never,
  });

  const response = await handler(
    new Request("http://localhost/api/connections/managed-auth/webhook", {
      method: "POST",
      headers: { "x-pd-signature": "t=1,v1=sig" },
      body: "{}",
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Connected account user mismatch",
  });
});

test("managed auth webhook rejects unknown users before writing credentials", async () => {
  const { createManagedAuthWebhookPostHandler } =
    await loadManagedAuthWebhookRoute();
  let wrote = false;

  const handler = createManagedAuthWebhookPostHandler({
    verifyPipedreamWebhookSignature: () => {},
    parsePipedreamConnectionWebhookPayload: () =>
      ({
        event: "CONNECTION_SUCCESS",
        connect_token: "tok_123",
        connect_session_id: 1,
        environment: "development",
        account: {
          id: "apn_sentry_123",
          external_id: "ghost-user",
          healthy: true,
          dead: null,
          app: { name_slug: "sentry", name: "Sentry", auth_type: "oauth" },
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-23T00:00:00.000Z",
        },
      }) as const,
    retrievePipedreamAccount: async () =>
      ({
        id: "apn_sentry_123",
        name: "Acme Sentry",
        external_id: "ghost-user",
        healthy: true,
        dead: null,
        app: { name_slug: "sentry", name: "Sentry", auth_type: "oauth" },
        created_at: "2026-04-23T00:00:00.000Z",
        updated_at: "2026-04-23T00:00:00.000Z",
      }) as never,
    getUserById: async (userId) => {
      assert.equal(userId, "ghost-user");
      return false;
    },
    upsertConnectionBySourcePreset: async () => {
      wrote = true;
      return "conn-1";
    },
  });

  const response = await handler(
    new Request("http://localhost/api/connections/managed-auth/webhook", {
      method: "POST",
      headers: { "x-pd-signature": "t=1,v1=sig" },
      body: "{}",
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Unknown user" });
  assert.equal(wrote, false);
});

test("managed auth webhook sanitizes config errors", async () => {
  const { createManagedAuthWebhookPostHandler } =
    await loadManagedAuthWebhookRoute();
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const handler = createManagedAuthWebhookPostHandler({
      verifyPipedreamWebhookSignature: () => {
        throw new PipedreamConnectConfigError(
          "PIPEDREAM_CONNECT_WEBHOOK_SIGNING_KEY is required"
        );
      },
    });

    const response = await handler(
      new Request("http://localhost/api/connections/managed-auth/webhook", {
        method: "POST",
        headers: { "x-pd-signature": "t=1,v1=sig" },
        body: "{}",
      })
    );

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Server configuration error",
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("managed auth webhook rejects unexpected app slugs before account retrieval", async () => {
  const { createManagedAuthWebhookPostHandler } =
    await loadManagedAuthWebhookRoute();
  let retrieved = false;

  const handler = createManagedAuthWebhookPostHandler({
    verifyPipedreamWebhookSignature: () => {},
    parsePipedreamConnectionWebhookPayload: () =>
      ({
        event: "CONNECTION_SUCCESS",
        connect_token: "tok_123",
        connect_session_id: 1,
        environment: "development",
        account: {
          id: "apn_other_123",
          external_id: "user-123",
          healthy: true,
          dead: null,
          app: {
            name_slug: "not-sentry",
            name: "Not Sentry",
            auth_type: "oauth",
          },
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-23T00:00:00.000Z",
        },
      }) as const,
    retrievePipedreamAccount: async () => {
      retrieved = true;
      return {} as never;
    },
  });

  const response = await handler(
    new Request("http://localhost/api/connections/managed-auth/webhook", {
      method: "POST",
      headers: { "x-pd-signature": "t=1,v1=sig" },
      body: "{}",
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Unexpected Pipedream app for Sentry managed auth",
  });
  assert.equal(retrieved, false);
});

test("managed auth webhook keeps generic failures opaque to the caller", async () => {
  const { createManagedAuthWebhookPostHandler } =
    await loadManagedAuthWebhookRoute();
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const handler = createManagedAuthWebhookPostHandler({
      verifyPipedreamWebhookSignature: () => {},
      parsePipedreamConnectionWebhookPayload: () =>
        ({
          event: "CONNECTION_SUCCESS",
          connect_token: "tok_123",
          connect_session_id: 1,
          environment: "development",
          account: {
            id: "apn_sentry_123",
            external_id: "user-123",
            healthy: true,
            dead: null,
            app: { name_slug: "sentry", name: "Sentry", auth_type: "oauth" },
            created_at: "2026-04-23T00:00:00.000Z",
            updated_at: "2026-04-23T00:00:00.000Z",
          },
        }) as const,
      retrievePipedreamAccount: async () =>
        ({
          id: "apn_sentry_123",
          name: "Acme Sentry",
          external_id: "user-123",
          healthy: true,
          dead: null,
          app: { name_slug: "sentry", name: "Sentry", auth_type: "oauth" },
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-23T00:00:00.000Z",
        }) as never,
      buildSentryManagedAuthCredentials: () => {
        throw new Error("upstream account payload leaked");
      },
    });

    const response = await handler(
      new Request("http://localhost/api/connections/managed-auth/webhook", {
        method: "POST",
        headers: { "x-pd-signature": "t=1,v1=sig" },
        body: "{}",
      })
    );

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Webhook processing failed",
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("managed auth webhook validates the retrieved sentry account before user lookup", async () => {
  const { createManagedAuthWebhookPostHandler } =
    await loadManagedAuthWebhookRoute();
  const originalConsoleError = console.error;
  console.error = () => {};
  let lookedUpUser = false;

  try {
    const handler = createManagedAuthWebhookPostHandler({
      verifyPipedreamWebhookSignature: () => {},
      parsePipedreamConnectionWebhookPayload: () =>
        ({
          event: "CONNECTION_SUCCESS",
          connect_token: "tok_123",
          connect_session_id: 1,
          environment: "development",
          account: {
            id: "apn_sentry_123",
            external_id: "user-123",
            healthy: true,
            dead: null,
            app: { name_slug: "sentry", name: "Sentry", auth_type: "oauth" },
            created_at: "2026-04-23T00:00:00.000Z",
            updated_at: "2026-04-23T00:00:00.000Z",
          },
        }) as const,
      retrievePipedreamAccount: async () =>
        ({
          id: "apn_sentry_123",
          name: "Acme Sentry",
          external_id: "user-123",
          healthy: false,
          dead: null,
          error: "reconnect required",
          app: { name_slug: "sentry", name: "Sentry", auth_type: "oauth" },
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-23T00:00:00.000Z",
        }) as never,
      buildSentryManagedAuthCredentials: () => {
        throw new Error("reconnect required");
      },
      getUserById: async () => {
        lookedUpUser = true;
        return true;
      },
    });

    const response = await handler(
      new Request("http://localhost/api/connections/managed-auth/webhook", {
        method: "POST",
        headers: { "x-pd-signature": "t=1,v1=sig" },
        body: "{}",
      })
    );

    assert.equal(response.status, 500);
    assert.equal(lookedUpUser, false);
  } finally {
    console.error = originalConsoleError;
  }
});

test("managed auth webhook upserts the canonical external user connection", async () => {
  const { createManagedAuthWebhookPostHandler } =
    await loadManagedAuthWebhookRoute();
  let upserted: { userId: string; input: Record<string, unknown> } | null =
    null;

  const handler = createManagedAuthWebhookPostHandler({
    verifyPipedreamWebhookSignature: () => {},
    parsePipedreamConnectionWebhookPayload: () =>
      ({
        event: "CONNECTION_SUCCESS",
        connect_token: "tok_123",
        connect_session_id: 1,
        environment: "development",
        account: {
          id: "apn_sentry_123",
          external_id: "user-123",
          healthy: true,
          dead: null,
          app: { name_slug: "sentry", name: "Sentry", auth_type: "oauth" },
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-23T00:00:00.000Z",
        },
      }) as const,
    retrievePipedreamAccount: async () =>
      ({
        id: "apn_sentry_123",
        name: "Acme Sentry",
        external_id: "user-123",
        healthy: true,
        dead: null,
        authorized_scopes: ["event:read"],
        app: { name_slug: "sentry", name: "Sentry", auth_type: "oauth" },
        created_at: "2026-04-23T00:00:00.000Z",
        updated_at: "2026-04-23T01:00:00.000Z",
        expires_at: null,
      }) as never,
    getConnectionPreset: () =>
      ({
        id: "sentry",
        name: "Sentry",
        description: "Error tracking",
        mcp_transport: "http",
        mcp_url: "https://mcp.sentry.dev/mcp",
      }) as never,
    getUserById: async () => true,
    buildSentryManagedAuthCredentials: () => '{"kind":"pipedream_connect"}',
    upsertConnectionBySourcePreset: async (userId, input) => {
      upserted = { userId, input: input as Record<string, unknown> };
      return "conn-upserted";
    },
  });

  const response = await handler(
    new Request("http://localhost/api/connections/managed-auth/webhook", {
      method: "POST",
      headers: { "x-pd-signature": "t=1,v1=sig" },
      body: "{}",
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(upserted, {
    userId: "user-123",
    input: {
      source_preset: "sentry",
      name: "Sentry",
      type: "mcp_server",
      auth_type: "oauth",
      auth_header: "Authorization",
      mcp_transport: "http",
      mcp_url: "https://mcp.sentry.dev/mcp",
      credentials: '{"kind":"pipedream_connect"}',
      description: "Error tracking",
      oauth_client_id: null,
      oauth_authorize_url: null,
      oauth_token_url: null,
      oauth_authorized_at: "2026-04-23T01:00:00.000Z",
      oauth_token_expires_at: null,
      oauth_scopes: "event:read",
    },
  });
});
