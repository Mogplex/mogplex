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
