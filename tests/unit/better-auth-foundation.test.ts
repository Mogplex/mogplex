import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sendAuthActionEmail } from "../../lib/email/send-auth-action-email";

test("should construct the better-auth instance when no auth env is set", async () => {
  // CI and Docker builds import this module with zero better-auth env; a
  // module-load throw here would break `next build` page-data collection the
  // same way the Supabase admin client once did.
  const { auth } = await import("../../lib/better-auth/server");

  assert.equal(typeof auth.handler, "function");
  assert.equal(typeof auth.api.getSession, "function");
  assert.equal(typeof auth.api.getMcpSession, "function");
});

test("should serve Better Auth MCP authorization-server metadata", async () => {
  const { GET } = await import("../../app/api/auth/[...all]/route");
  const response = await GET(
    new Request(
      "http://localhost:3000/api/auth/.well-known/oauth-authorization-server"
    )
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    issuer: "http://localhost:3000",
    authorization_endpoint: "http://localhost:3000/api/auth/mcp/authorize",
    token_endpoint: "http://localhost:3000/api/auth/mcp/token",
    userinfo_endpoint: "http://localhost:3000/api/auth/mcp/userinfo",
    jwks_uri: "http://localhost:3000/api/auth/mcp/jwks",
    registration_endpoint: "http://localhost:3000/api/auth/mcp/register",
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    acr_values_supported: [
      "urn:mace:incommon:iap:silver",
      "urn:mace:incommon:iap:bronze",
    ],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "none",
    ],
    code_challenge_methods_supported: ["S256"],
    claims_supported: [
      "sub",
      "iss",
      "aud",
      "exp",
      "nbf",
      "iat",
      "jti",
      "email",
      "email_verified",
      "name",
    ],
  });
});

test("should expose Better Auth metadata at the issuer root with Mogplex scopes", async () => {
  const { GET } =
    await import("../../app/.well-known/oauth-authorization-server/route");
  const response = await GET(
    new Request("http://localhost:3000/.well-known/oauth-authorization-server")
  );
  const metadata = (await response.json()) as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    scopes_supported: string[];
  };

  assert.equal(response.status, 200);
  assert.equal(metadata.issuer, "http://localhost:3000");
  assert.equal(
    metadata.authorization_endpoint,
    "http://localhost:3000/api/auth/mcp/authorize"
  );
  assert.equal(
    metadata.token_endpoint,
    "http://localhost:3000/api/auth/mcp/token"
  );
  assert.equal(
    metadata.registration_endpoint,
    "http://localhost:3000/api/auth/mcp/register"
  );
  assert.deepEqual(metadata.scopes_supported, [
    "openid",
    "profile",
    "email",
    "offline_access",
    "read",
    "write",
  ]);
});

test("should migrate Better Auth MCP OAuth tables with UUID user references", async () => {
  const sql = await readFile(
    new URL(
      "../../neon/migrations/20260805183000_better_auth_mcp_oauth.sql",
      import.meta.url
    ),
    "utf8"
  );

  for (const table of [
    "oauthApplication",
    "oauthAccessToken",
    "oauthConsent",
  ]) {
    assert.match(sql, new RegExp(`create table "${table}"`, "i"));
  }
  assert.match(sql, /"id" uuid not null primary key/i);
  assert.match(
    sql,
    /"userId" uuid(?: not null)? references "user" \("id"\) on delete cascade/i
  );
  assert.match(
    sql,
    /"clientId" text not null references "oauthApplication" \("clientId"\) on delete cascade/i
  );
});

test("should exclude social providers when their env vars are unset", async () => {
  const { auth } = await import("../../lib/better-auth/server");

  const providers = auth.options.socialProviders ?? {};
  assert.deepEqual(Object.keys(providers), []);
});

test("should fall back to log delivery when RESEND_API_KEY is unset", async (t) => {
  const original = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message: string) => {
    warnings.push(message);
  };
  t.after(() => {
    console.warn = originalWarn;
    if (original !== undefined) process.env.RESEND_API_KEY = original;
  });

  const result = await sendAuthActionEmail({
    kind: "verify-email",
    email: "test@example.com",
    actionUrl: "https://mogplex.com/api/auth/verify-email?token=t",
  });

  assert.deepEqual(result, { ok: true, channel: "log" });
  const logged = warnings.map((w) => JSON.parse(w));
  assert.equal(logged.length, 1);
  assert.equal(logged[0].event, "auth_action_email_pending_delivery");
  assert.equal(
    logged[0].actionUrl,
    "https://mogplex.com/api/auth/verify-email?token=t"
  );
});

test("should fail closed and redact the token when RESEND_API_KEY is unset in production", async (t) => {
  const env = process.env as Record<string, string | undefined>;
  const originalKey = env.RESEND_API_KEY;
  const originalNodeEnv = env.NODE_ENV;
  delete env.RESEND_API_KEY;
  env.NODE_ENV = "production";
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message: string) => {
    errors.push(message);
  };
  t.after(() => {
    console.error = originalError;
    env.NODE_ENV = originalNodeEnv;
    if (originalKey !== undefined) env.RESEND_API_KEY = originalKey;
  });

  const result = await sendAuthActionEmail({
    kind: "reset-password",
    email: "test@example.com",
    actionUrl: "https://mogplex.com/api/auth/reset-password?token=secret-token",
  });

  assert.deepEqual(result, { ok: false, reason: "not_configured" });
  const logged = errors.map((e) => JSON.parse(e));
  assert.equal(logged.length, 1);
  assert.equal(logged[0].event, "auth_action_email_not_configured");
  assert.equal(
    logged[0].actionUrl,
    "https://mogplex.com/api/auth/reset-password?[redacted]"
  );
  assert.ok(!errors[0].includes("secret-token"));
});

test("should 503 auth routes when BETTER_AUTH_SECRET is unset in production", async (t) => {
  const env = process.env as Record<string, string | undefined>;
  const originalSecret = env.BETTER_AUTH_SECRET;
  const originalNodeEnv = env.NODE_ENV;
  delete env.BETTER_AUTH_SECRET;
  env.NODE_ENV = "production";
  t.after(() => {
    env.NODE_ENV = originalNodeEnv;
    if (originalSecret !== undefined) env.BETTER_AUTH_SECRET = originalSecret;
  });

  const { GET } = await import("../../app/api/auth/[...all]/route");
  const response = await GET(new Request("https://mogplex.com/api/auth/ok"));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "auth_not_configured" });
});

test("should 404 SSO provider registration until SSO onboarding ships", async () => {
  const { POST } = await import("../../app/api/auth/[...all]/route");
  const response = await POST(
    new Request("https://mogplex.com/api/auth/sso/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issuer: "https://idp.example.com" }),
    })
  );

  assert.equal(response.status, 404);
});
