import assert from "node:assert/strict";
import test from "node:test";

const APP_ORIGIN = "http://localhost";

// Node caches dynamic imports, so every call to loadVercelTokenRoute() returns
// the same module instance. The handlers are exported as factory functions
// (createVercelTokenPostHandler / createVercelTokenDeleteHandler) and each
// test passes its own overrides — never mutate the module's defaultDeps
// directly or you will silently bleed state into every later test in this
// process.
async function loadVercelTokenRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.NEXT_PUBLIC_APP_URL ||= APP_ORIGIN;
  return import("../../app/api/auth/vercel/token/route");
}

type CsrfOptions = {
  withCsrfHeader?: boolean;
  origin?: string | null;
  referer?: string | null;
};

function applyCsrfHeaders(
  headers: Record<string, string>,
  { withCsrfHeader = true, origin = APP_ORIGIN, referer }: CsrfOptions
) {
  if (withCsrfHeader) headers["X-Requested-With"] = "XMLHttpRequest";
  if (origin !== null) headers.Origin = origin;
  if (referer) headers.Referer = referer;
}

function createPostRequest(body: unknown, options: CsrfOptions = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  applyCsrfHeaders(headers, options);
  return new Request(`${APP_ORIGIN}/api/auth/vercel/token`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function createDeleteRequest(options: CsrfOptions = {}) {
  const headers: Record<string, string> = {};
  applyCsrfHeaders(headers, options);
  return new Request(`${APP_ORIGIN}/api/auth/vercel/token`, {
    method: "DELETE",
    headers,
  });
}

function mockResponse(status: number) {
  return new Response(status === 204 ? null : "{}", { status });
}

test("POST /api/auth/vercel/token stores a valid token", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  const stored: Array<{
    userId: string;
    provider: string;
    token: string;
  }> = [];

  const handler = createVercelTokenPostHandler({
    requireUserId: async () => "user-1",
    storeOAuthToken: async (userId, provider, token) => {
      stored.push({ userId, provider, token });
    },
    deleteOAuthToken: async () => {
      throw new Error("delete should not be called on POST");
    },
    fetch: async () => mockResponse(200),
  });

  const response = await handler(createPostRequest({ token: "vercel_abc123" }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(stored, [
    { userId: "user-1", provider: "vercel", token: "vercel_abc123" },
  ]);
});

test("POST /api/auth/vercel/token trims whitespace before validating", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  let receivedAuth: string | null = null;
  const stored: string[] = [];

  const handler = createVercelTokenPostHandler({
    requireUserId: async () => "user-1",
    storeOAuthToken: async (_userId, _provider, token) => {
      stored.push(token);
    },
    deleteOAuthToken: async () => {},
    fetch: async (_url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      receivedAuth = headers?.Authorization ?? null;
      return mockResponse(200);
    },
  });

  const response = await handler(
    createPostRequest({ token: "  padded_token  " })
  );

  assert.equal(response.status, 200);
  assert.equal(receivedAuth, "Bearer padded_token");
  assert.deepEqual(stored, ["padded_token"]);
});

test("POST /api/auth/vercel/token rejects 403 with insufficient_scope", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  let storeCalled = false;
  const handler = createVercelTokenPostHandler({
    requireUserId: async () => "user-1",
    storeOAuthToken: async () => {
      storeCalled = true;
    },
    deleteOAuthToken: async () => {},
    fetch: async () => mockResponse(403),
  });

  const response = await handler(createPostRequest({ token: "oidc-only" }));

  assert.equal(response.status, 403);
  const body = (await response.json()) as { error?: string; message?: string };
  assert.equal(body.error, "VERCEL_TOKEN_INSUFFICIENT_SCOPE");
  assert.ok(body.message?.includes("vercel.com/account/tokens"));
  assert.equal(storeCalled, false);
});

test("POST /api/auth/vercel/token returns 502 when validation fetch throws", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  let storeCalled = false;
  const handler = createVercelTokenPostHandler({
    requireUserId: async () => "user-1",
    storeOAuthToken: async () => {
      storeCalled = true;
    },
    deleteOAuthToken: async () => {},
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });

  const response = await handler(createPostRequest({ token: "vercel_abc123" }));

  assert.equal(response.status, 502);
  const body = (await response.json()) as { error?: string; message?: string };
  assert.equal(body.error, "VERCEL_TOKEN_VALIDATION_FAILED");
  assert.ok(body.message);
  assert.equal(storeCalled, false);
});

test("POST /api/auth/vercel/token rejects 401 with invalid_token", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenPostHandler({
    requireUserId: async () => "user-1",
    storeOAuthToken: async () => {
      throw new Error("should not store invalid token");
    },
    deleteOAuthToken: async () => {},
    fetch: async () => mockResponse(401),
  });

  const response = await handler(createPostRequest({ token: "bogus" }));

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "VERCEL_TOKEN_INVALID");
});

test("POST /api/auth/vercel/token rejects missing token with 400", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenPostHandler({
    requireUserId: async () => "user-1",
    storeOAuthToken: async () => {
      throw new Error("should not store");
    },
    deleteOAuthToken: async () => {},
    fetch: async () => {
      throw new Error("should not call Vercel for missing token");
    },
  });

  const response = await handler(createPostRequest({ token: "   " }));

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "Token is required");
});

test("POST /api/auth/vercel/token rejects unparsable JSON body with 400", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenPostHandler({
    requireUserId: async () => "user-1",
    storeOAuthToken: async () => {},
    deleteOAuthToken: async () => {},
    fetch: async () => mockResponse(200),
  });

  const response = await handler(createPostRequest("not-json"));

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "Invalid JSON body");
});

test("POST /api/auth/vercel/token rejects array body with 400", async () => {
  // Exercises the Array.isArray guard specifically: JSON.parse succeeds,
  // but the parsed value is not a plain object.
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenPostHandler({
    requireUserId: async () => "user-1",
    storeOAuthToken: async () => {
      throw new Error("should not store array body");
    },
    deleteOAuthToken: async () => {},
    fetch: async () => {
      throw new Error("should not call Vercel for array body");
    },
  });

  const response = await handler(createPostRequest(["array"]));

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "Body must be a JSON object");
});

test("POST /api/auth/vercel/token rejects requests missing X-Requested-With", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenPostHandler({
    requireUserId: async () => {
      throw new Error("auth should not run when CSRF guard rejects");
    },
    storeOAuthToken: async () => {
      throw new Error("store should not run");
    },
    deleteOAuthToken: async () => {},
    fetch: async () => {
      throw new Error("fetch should not run");
    },
  });

  const response = await handler(
    createPostRequest({ token: "vercel_abc123" }, { withCsrfHeader: false })
  );

  assert.equal(response.status, 403);
});

test("POST /api/auth/vercel/token rejects mismatched Origin header", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenPostHandler({
    requireUserId: async () => {
      throw new Error("auth should not run when CSRF guard rejects");
    },
    storeOAuthToken: async () => {},
    deleteOAuthToken: async () => {},
    fetch: async () => {
      throw new Error("fetch should not run");
    },
  });

  const response = await handler(
    createPostRequest(
      { token: "vercel_abc123" },
      { origin: "https://evil.example" }
    )
  );

  assert.equal(response.status, 403);
});

test("POST /api/auth/vercel/token rejects request with no Origin and no Referer", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenPostHandler({
    requireUserId: async () => {
      throw new Error("auth should not run when CSRF guard rejects");
    },
    storeOAuthToken: async () => {},
    deleteOAuthToken: async () => {},
    fetch: async () => {
      throw new Error("fetch should not run");
    },
  });

  const response = await handler(
    createPostRequest({ token: "vercel_abc123" }, { origin: null })
  );

  assert.equal(response.status, 403);
});

test("POST /api/auth/vercel/token accepts request with matching Referer when Origin is absent", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenPostHandler({
    requireUserId: async () => "user-1",
    storeOAuthToken: async () => {},
    deleteOAuthToken: async () => {},
    fetch: async () => mockResponse(200),
  });

  const response = await handler(
    createPostRequest(
      { token: "vercel_abc123" },
      { origin: null, referer: `${APP_ORIGIN}/settings` }
    )
  );

  assert.equal(response.status, 200);
});

test("POST /api/auth/vercel/token rejects mismatched Referer when Origin is absent", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenPostHandler({
    requireUserId: async () => {
      throw new Error("auth should not run when CSRF guard rejects");
    },
    storeOAuthToken: async () => {},
    deleteOAuthToken: async () => {},
    fetch: async () => {
      throw new Error("fetch should not run");
    },
  });

  const response = await handler(
    createPostRequest(
      { token: "vercel_abc123" },
      { origin: null, referer: "https://evil.example/settings" }
    )
  );

  assert.equal(response.status, 403);
});

test("DELETE /api/auth/vercel/token clears the stored token", async () => {
  const { createVercelTokenDeleteHandler } = await loadVercelTokenRoute();

  const deleted: Array<{ userId: string; provider: string }> = [];

  const handler = createVercelTokenDeleteHandler({
    requireUserId: async () => "user-1",
    storeOAuthToken: async () => {
      throw new Error("store should not be called on DELETE");
    },
    deleteOAuthToken: async (userId, provider) => {
      deleted.push({ userId, provider });
    },
    fetch: async () => {
      throw new Error("fetch should not be called on DELETE");
    },
  });

  const response = await handler(createDeleteRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(deleted, [{ userId: "user-1", provider: "vercel" }]);
});

test("POST /api/auth/vercel/token returns 500 when storeOAuthToken throws", async () => {
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenPostHandler({
    requireUserId: async () => "user-1",
    storeOAuthToken: async () => {
      throw new Error("supabase exploded");
    },
    deleteOAuthToken: async () => {},
    fetch: async () => mockResponse(200),
  });

  const response = await handler(createPostRequest({ token: "vercel_abc123" }));

  assert.equal(response.status, 500);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "VERCEL_TOKEN_STORE_FAILED");
});

test("POST /api/auth/vercel/token returns 401 when requireUserId returns a non-string non-Response", async () => {
  // Regression test for the auth contract hardening: even if requireUserId
  // is refactored to return e.g. `{ error, status }`, the route must not
  // pass that value through to storeOAuthToken as the user id.
  const { createVercelTokenPostHandler } = await loadVercelTokenRoute();

  let storeCalled = false;
  const handler = createVercelTokenPostHandler({
    // Deliberately violate the type contract to exercise the runtime guard.
    requireUserId: (async () => ({ error: "nope", status: 401 })) as never,
    storeOAuthToken: async () => {
      storeCalled = true;
    },
    deleteOAuthToken: async () => {},
    fetch: async () => mockResponse(200),
  });

  const response = await handler(createPostRequest({ token: "vercel_abc123" }));

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "Unauthorized");
  assert.equal(storeCalled, false);
});

test("DELETE /api/auth/vercel/token returns 500 when deleteOAuthToken throws", async () => {
  const { createVercelTokenDeleteHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenDeleteHandler({
    requireUserId: async () => "user-1",
    storeOAuthToken: async () => {},
    deleteOAuthToken: async () => {
      throw new Error("supabase exploded");
    },
    fetch: async () => {
      throw new Error("fetch should not run on DELETE");
    },
  });

  const response = await handler(createDeleteRequest());

  assert.equal(response.status, 500);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "VERCEL_TOKEN_DELETE_FAILED");
});

test("DELETE /api/auth/vercel/token rejects mismatched Origin header", async () => {
  const { createVercelTokenDeleteHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenDeleteHandler({
    requireUserId: async () => {
      throw new Error("auth should not run when CSRF guard rejects");
    },
    storeOAuthToken: async () => {},
    deleteOAuthToken: async () => {
      throw new Error("delete should not run");
    },
    fetch: async () => mockResponse(200),
  });

  const response = await handler(
    createDeleteRequest({ origin: "https://evil.example" })
  );

  assert.equal(response.status, 403);
});

test("DELETE /api/auth/vercel/token rejects mismatched Referer when Origin is absent", async () => {
  const { createVercelTokenDeleteHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenDeleteHandler({
    requireUserId: async () => {
      throw new Error("auth should not run when CSRF guard rejects");
    },
    storeOAuthToken: async () => {},
    deleteOAuthToken: async () => {
      throw new Error("delete should not run");
    },
    fetch: async () => mockResponse(200),
  });

  const response = await handler(
    createDeleteRequest({
      origin: null,
      referer: "https://evil.example/settings",
    })
  );

  assert.equal(response.status, 403);
});

test("DELETE /api/auth/vercel/token returns 401 when requireUserId returns a non-string non-Response", async () => {
  // Mirrors the POST regression test: a future refactor that breaks the auth
  // guard on one handler but not the other should not slip through.
  const { createVercelTokenDeleteHandler } = await loadVercelTokenRoute();

  let deleteCalled = false;
  const handler = createVercelTokenDeleteHandler({
    // Deliberately violate the type contract to exercise the runtime guard.
    requireUserId: (async () => ({ error: "nope", status: 401 })) as never,
    storeOAuthToken: async () => {},
    deleteOAuthToken: async () => {
      deleteCalled = true;
    },
    fetch: async () => mockResponse(200),
  });

  const response = await handler(createDeleteRequest());

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "Unauthorized");
  assert.equal(deleteCalled, false);
});

test("DELETE /api/auth/vercel/token rejects requests missing X-Requested-With", async () => {
  const { createVercelTokenDeleteHandler } = await loadVercelTokenRoute();

  const handler = createVercelTokenDeleteHandler({
    requireUserId: async () => {
      throw new Error("auth should not run when CSRF guard rejects");
    },
    storeOAuthToken: async () => {},
    deleteOAuthToken: async () => {
      throw new Error("delete should not run");
    },
    fetch: async () => mockResponse(200),
  });

  const response = await handler(
    createDeleteRequest({ withCsrfHeader: false })
  );

  assert.equal(response.status, 403);
});
