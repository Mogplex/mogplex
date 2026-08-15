// Integration coverage for the better-auth + Neon stack: unlike the rest of
// the suite these tests mock nothing — they drive the real /api/auth handlers,
// which write real rows through the real pg pool. Requires DATABASE_URL (or
// the Neon integration's mogplex_DATABASE_URL) to point at a database with the
// neon/migrations schema applied; the file self-skips when neither is
// resolvable so DB-less environments still run the rest of the suite.
import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { verifyPassword } from "better-auth/crypto";
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
    page,
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
      'select "providerId", "password" from "account" where "userId" = $1',
      [created.rows[0].id]
    );
    expect(credential.rows.map((row) => row.providerId)).toContain(
      "credential"
    );
    const storedPassword = credential.rows.find(
      (row) => row.providerId === "credential"
    )?.password;
    if (typeof storedPassword !== "string") {
      throw new TypeError("Credential account did not persist a password hash");
    }
    expect(storedPassword).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(storedPassword).not.toBe(password);
    await expect(
      verifyPassword({ hash: storedPassword, password })
    ).resolves.toBe(true);

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

    // Exercise the CLI OAuth round trip as `mogplex login` drives it:
    // authorize (no session) → /login carrying the authorize query → sign-in
    // → top-level navigation back through authorize → 302 to the loopback
    // redirect with an authorization code → PKCE token exchange.
    //
    // CI's database may not have pending migrations applied (they run on
    // deploy), so self-provision the CLI's public OAuth client with the
    // same idempotent upsert as neon/migrations/20260806100000.
    await pool.query(`
      insert into "oauthApplication" (
        "id", "name", "clientId", "clientSecret", "redirectUrls",
        "type", "disabled", "createdAt", "updatedAt"
      ) values (
        gen_random_uuid(), 'Mogplex CLI', 'mogplex-cli', '',
        'http://127.0.0.1:24816/auth/callback,http://127.0.0.1:24818/auth/callback,http://localhost:24816/auth/callback,http://localhost:24818/auth/callback',
        'public', false, now(), now()
      )
      on conflict ("clientId") do update set
        "redirectUrls" = excluded."redirectUrls",
        "type" = excluded."type",
        "disabled" = excluded."disabled",
        "updatedAt" = now()
    `);

    const verifier = crypto.randomBytes(64).toString("base64url");
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    const state = crypto.randomBytes(32).toString("base64url");
    const redirectUri = "http://127.0.0.1:24816/auth/callback";

    // Stand in for the CLI's loopback server: capture the code-bearing
    // navigation the browser makes after the authorize redirect.
    const { createServer } = await import("node:http");
    let captureCallback!: (url: string) => void;
    const captured = new Promise<string>((resolve) => {
      captureCallback = resolve;
    });
    const loopback = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      if (req.url?.startsWith("/auth/callback")) captureCallback(req.url);
    });
    await new Promise<void>((resolve) =>
      loopback.listen(24816, "127.0.0.1", resolve)
    );

    try {
      const authorizeQuery = new URLSearchParams({
        response_type: "code",
        client_id: "mogplex-cli",
        redirect_uri: redirectUri,
        scope: "openid profile email offline_access read write",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      await page.goto(`/api/auth/mcp/authorize?${authorizeQuery.toString()}`);
      const loginUrl = new URL(page.url());
      expect(loginUrl.pathname).toBe("/login");
      expect(loginUrl.searchParams.get("client_id")).toBe("mogplex-cli");

      await page.getByTestId("signin-email").fill(email);
      await page.getByTestId("signin-password").fill(password);
      await page.getByTestId("signin-submit").click();

      const callbackUrl = new URL(await captured, redirectUri);
      expect(callbackUrl.searchParams.get("state")).toBe(state);
      const code = callbackUrl.searchParams.get("code");
      expect(code).toBeTruthy();

      const sessionRows = await pool.query(
        'select id from "session" where "userId" = $1',
        [created.rows[0].id]
      );
      expect(sessionRows.rowCount).toBeGreaterThan(0);

      // Public-client token exchange: PKCE verifier, no client secret.
      const tokenRes = await request.post("/api/auth/mcp/token", {
        form: {
          grant_type: "authorization_code",
          client_id: "mogplex-cli",
          code: code!,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        },
      });
      const tokenBody = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        id_token?: string;
      };
      expect(tokenRes.status(), JSON.stringify(tokenBody)).toBe(200);
      expect(tokenBody.access_token).toBeTruthy();
      expect(tokenBody.refresh_token).toBeTruthy();
      expect(tokenBody.id_token).toBeTruthy();

      // The rotating refresh grant works without a client secret too.
      const refreshRes = await request.post("/api/auth/mcp/token", {
        form: {
          grant_type: "refresh_token",
          client_id: "mogplex-cli",
          refresh_token: tokenBody.refresh_token!,
        },
      });
      const refreshBody = (await refreshRes.json()) as {
        access_token?: string;
      };
      expect(refreshRes.status(), JSON.stringify(refreshBody)).toBe(200);
      expect(refreshBody.access_token).toBeTruthy();
      expect(refreshBody.access_token).not.toBe(tokenBody.access_token);

      // The cliTokenTtl hook clamps CLI refresh tokens to 30 days even
      // though the provider-wide setting is effectively-never (MCP clients).
      const ttlRows = await pool.query(
        `select "refreshTokenExpiresAt" from "oauthAccessToken"
          where "clientId" = 'mogplex-cli' and "userId" = $1`,
        [created.rows[0].id]
      );
      expect(ttlRows.rowCount).toBeGreaterThan(0);
      const maxTtlMs = 31 * 24 * 60 * 60 * 1000;
      for (const row of ttlRows.rows) {
        const expiresAt = new Date(row.refreshTokenExpiresAt).getTime();
        expect(expiresAt).toBeLessThan(Date.now() + maxTtlMs);
        expect(expiresAt).toBeGreaterThan(Date.now());
      }
    } finally {
      loopback.close();
      loopback.closeAllConnections();
    }

    // Retired PAT handoff: old CLI builds hitting /cli-auth get an upgrade
    // prompt, not a consent screen (and no login redirect loop).
    const browserRequest = page.context().request;
    const cliAuth = await browserRequest.get("/cli-auth", {
      maxRedirects: 0,
    });
    expect(cliAuth.status()).toBe(200);
    expect(await cliAuth.text()).toContain("CLI login has moved");

    // Sign-out invalidates the session server-side, not just the cookie. The
    // Origin header satisfies better-auth's CSRF check for cookie-backed
    // POSTs (browsers send it automatically; the API context does not).
    const signOut = await browserRequest.post("/api/auth/sign-out", {
      data: {},
      headers: { origin: new URL(signUp.url()).origin },
    });
    expect(signOut.status()).toBe(200);

    const afterSignOut = await browserRequest.get("/api/auth/get-session");
    const afterBody = (await afterSignOut.json().catch(() => null)) as {
      user?: { email?: string };
    } | null;
    expect(afterBody?.user?.email ?? null).toBeNull();

    // /cli-auth is public now (upgrade notice for pre-OAuth CLI builds) —
    // logged-out visitors see it directly instead of a login bounce.
    const loggedOutCliAuth = await browserRequest.get("/cli-auth", {
      maxRedirects: 0,
    });
    expect(loggedOutCliAuth.status()).toBe(200);
    expect(await loggedOutCliAuth.text()).toContain("CLI login has moved");
  });
});
