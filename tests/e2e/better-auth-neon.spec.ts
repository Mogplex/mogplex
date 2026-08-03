// Integration coverage for the better-auth + Neon stack: unlike the rest of
// the suite these tests mock nothing — they drive the real /api/auth handlers,
// which write real rows through the real pg pool. Requires DATABASE_URL (or
// the Neon integration's mogplex_DATABASE_URL) to point at a database with the
// neon/migrations schema applied; the file self-skips when neither is
// resolvable so DB-less environments still run the rest of the suite.
import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { resolveNeonDatabaseUrl } from "./helpers/neon";

const databaseUrl = resolveNeonDatabaseUrl();

const uniqueSuffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const email = `e2e-${uniqueSuffix}@e2e.mogplex.test`;
const password = "e2e-Password-1234";

test.describe("better-auth against real Neon", () => {
  test.skip(
    !databaseUrl,
    "DATABASE_URL / mogplex_DATABASE_URL not resolvable — skipping real-database auth flow"
  );

  let pool: Pool;

  test.beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
  });

  test.afterAll(async () => {
    // session/account rows cascade from the user delete; the profile row
    // provisioned by the user-create hook is removed explicitly first.
    await pool.query(
      `delete from profiles where auth_user_id in
         (select id from "user" where email = $1)`,
      [email]
    );
    await pool.query('delete from "user" where email = $1', [email]);
    await pool.end();
  });

  test("email/password journey writes real rows and enforces verification", async ({
    request,
  }) => {
    // Sign-up succeeds (the e2e server logs the verification email instead of
    // sending) and persists a real, unverified user row.
    const signUp = await request.post("/api/auth/sign-up/email", {
      data: { name: "E2E Neon", email, password },
    });
    expect(signUp.status(), await signUp.text()).toBe(200);

    const created = await pool.query(
      'select id, "emailVerified" from "user" where email = $1',
      [email]
    );
    expect(created.rowCount).toBe(1);
    expect(created.rows[0].emailVerified).toBe(false);

    const credential = await pool.query(
      'select "providerId" from "account" where "userId" = $1',
      [created.rows[0].id]
    );
    expect(credential.rows.map((row) => row.providerId)).toContain(
      "credential"
    );

    // requireEmailVerification gates sign-in until the address is verified.
    const unverifiedSignIn = await request.post("/api/auth/sign-in/email", {
      data: { email, password },
    });
    expect(unverifiedSignIn.status()).toBe(403);

    // Verify out-of-band (the emailed link is the production path) and the
    // same credentials produce a session.
    await pool.query(
      'update "user" set "emailVerified" = true where email = $1',
      [email]
    );

    const wrongPassword = await request.post("/api/auth/sign-in/email", {
      data: { email, password: "definitely-not-it-1234" },
    });
    expect(wrongPassword.status()).toBe(401);

    const signIn = await request.post("/api/auth/sign-in/email", {
      data: { email, password },
    });
    expect(signIn.status(), await signIn.text()).toBe(200);

    const session = await request.get("/api/auth/get-session");
    expect(session.status()).toBe(200);
    const sessionBody = (await session.json()) as {
      user?: { email?: string };
    } | null;
    expect(sessionBody?.user?.email).toBe(email);

    const sessionRows = await pool.query(
      'select id from "session" where "userId" = $1',
      [created.rows[0].id]
    );
    expect(sessionRows.rowCount).toBeGreaterThan(0);

    // Sign-out invalidates the session server-side, not just the cookie. The
    // Origin header satisfies better-auth's CSRF check for cookie-backed
    // POSTs (browsers send it automatically; the API context does not).
    const signOut = await request.post("/api/auth/sign-out", {
      data: {},
      headers: { origin: new URL(signUp.url()).origin },
    });
    expect(signOut.status()).toBe(200);

    const afterSignOut = await request.get("/api/auth/get-session");
    const afterBody = (await afterSignOut.json().catch(() => null)) as {
      user?: { email?: string };
    } | null;
    expect(afterBody?.user?.email ?? null).toBeNull();
  });
});
