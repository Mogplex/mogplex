import assert from "node:assert/strict";
import test from "node:test";

async function loadManagedAuthRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/connections/managed-auth/route");
}

test("managed auth route returns 500 when connection lookup fails", async () => {
  const { createManagedAuthGetHandler } = await loadManagedAuthRoute();
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const handler = createManagedAuthGetHandler({
      requireUserId: async () => "user-1",
      findConnectionById: async () => {
        throw new Error("connection lookup exploded");
      },
    });

    const response = await handler(
      new Request(
        "http://localhost/api/connections/managed-auth?connectionId=conn-1"
      )
    );

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Internal error" });
  } finally {
    console.error = originalConsoleError;
  }
});

test("managed auth route returns 404 when the connection does not exist", async () => {
  const { createManagedAuthGetHandler } = await loadManagedAuthRoute();

  const handler = createManagedAuthGetHandler({
    requireUserId: async () => "user-1",
    findConnectionById: async () => null,
  });

  const response = await handler(
    new Request(
      "http://localhost/api/connections/managed-auth?connectionId=conn-1"
    )
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Connection not found" });
});

test("managed auth route redirects to the sentry connect link for managed-auth presets", async () => {
  const { createManagedAuthGetHandler } = await loadManagedAuthRoute();

  const handler = createManagedAuthGetHandler({
    requireUserId: async () => "user-1",
    findConnectionById: async () =>
      ({
        id: "conn-1",
        source_preset: "sentry",
      }) as never,
    createSentryConnectLink: async (input) => {
      assert.equal(input.externalUserId, "user-1");
      assert.match(input.successRedirectUri, /oauth=success/);
      assert.match(input.errorRedirectUri, /oauth=setup_error/);
      assert.match(
        input.webhookUri,
        /\/api\/connections\/managed-auth\/webhook$/
      );
      return {
        connectLinkUrl: "https://connect.pipedream.com/link",
        expiresAt: "2026-04-23T02:00:00.000Z",
        token: "tok_123",
      };
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/connections/managed-auth?connectionId=conn-1"
    )
  );

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://connect.pipedream.com/link"
  );
});

test("managed auth route redirects to setup_error when connect link creation fails", async () => {
  const { createManagedAuthGetHandler } = await loadManagedAuthRoute();
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const handler = createManagedAuthGetHandler({
      requireUserId: async () => "user-1",
      findConnectionById: async () =>
        ({
          id: "conn-1",
          source_preset: "sentry",
        }) as never,
      createSentryConnectLink: async () => {
        throw new Error("pipedream unavailable");
      },
    });

    const response = await handler(
      new Request(
        "http://localhost/api/connections/managed-auth?connectionId=conn-1"
      )
    );

    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get("location"),
      "http://localhost/settings?tab=connections&oauth=setup_error"
    );
  } finally {
    console.error = originalConsoleError;
  }
});
