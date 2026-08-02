import assert from "node:assert/strict";
import test from "node:test";
import { sendAuthActionEmail } from "../../lib/email/send-auth-action-email";

test("should construct the better-auth instance when no auth env is set", async () => {
  // CI and Docker builds import this module with zero better-auth env; a
  // module-load throw here would break `next build` page-data collection the
  // same way the Supabase admin client once did.
  const { auth } = await import("../../lib/better-auth/server");

  assert.equal(typeof auth.handler, "function");
  assert.equal(typeof auth.api.getSession, "function");
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
