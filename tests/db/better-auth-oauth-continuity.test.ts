import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  AUTH_CLIENT_ID,
  AUTH_CLIENT_SECRET,
  AUTH_USER_ID,
  LEGACY_TOKEN_ID,
  authForDatabase,
  existingBrowserSession,
  migrateAuth,
  oldAuthDatabase,
  refreshRequest,
} from "./helpers/better-auth-oauth-fixture";

let db: PGlite;
beforeEach(async () => {
  db = await oldAuthDatabase();
});
afterEach(async () => {
  await db.close();
});
const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
const bearer = (token: string) =>
  new Headers({ authorization: `Bearer ${token}` });

describe("OAuth credentials across retained and upgraded releases", () => {
  it("preserves original rows and hashes credentials without changing their meaning", async () => {
    const before = await db.query(`select * from "oauthAccessToken"`);
    await migrateAuth(db);
    expect((await db.query(`select * from "oauthAccessToken"`)).rows).toEqual(
      before.rows
    );
    const client = (
      await db.query<{ redirectUris: string }>(`select * from "oauthClient"`)
    ).rows[0];
    expect(client).toMatchObject({
      clientId: AUTH_CLIENT_ID,
      clientSecret: hash(AUTH_CLIENT_SECRET),
      requirePKCE: true,
    });
    expect(JSON.parse(client.redirectUris as string)).toEqual([
      "http://localhost:24816/auth/callback",
    ]);
    const access = (
      await db.query<{ scopes: string }>(`select * from "oauthAccessTokenV2"`)
    ).rows[0];
    expect(access).toMatchObject({
      token: hash("legacy-access-token"),
      userId: AUTH_USER_ID,
      legacyOpaque: true,
    });
    expect(JSON.parse(access.scopes as string)).toEqual([
      "read",
      "write",
      "offline_access",
    ]);
    expect(
      (
        await db.query<{ token: string }>(
          `select token from "oauthRefreshToken"`
        )
      ).rows[0].token
    ).toBe(hash("legacy-refresh-token"));
  });

  it("keeps an existing browser session cookie and session ID valid", async () => {
    const cookie = await existingBrowserSession(db);
    await migrateAuth(db);
    const { instance } = authForDatabase(db);
    const session = await instance.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session?.user.id).toBe(AUTH_USER_ID);
    expect(session?.session.id).toBe("legacy-session-id");
  });

  it("synchronizes retained token updates and rejects the replaced bearer", async () => {
    await migrateAuth(db);
    await db.query(
      `update "oauthAccessToken" set "accessToken" = 'old-server-next-access',
      "refreshToken" = 'old-server-next-refresh', "accessTokenExpiresAt" = now() + interval '1 hour'
      where id = $1`,
      [LEGACY_TOKEN_ID]
    );
    const { instance, request } = authForDatabase(db);
    expect(
      await instance.api.getMcpSession({
        headers: bearer("legacy-access-token"),
      })
    ).toBeNull();
    expect(
      await instance.api.getMcpSession({
        headers: bearer("old-server-next-access"),
      })
    ).toMatchObject({ userId: AUTH_USER_ID });
    expect(
      (await request(refreshRequest("old-server-next-refresh"))).status
    ).toBe(200);
  });

  it("accepts the retained provider's INSERT-based refresh without invalidating other existing credentials", async () => {
    await migrateAuth(db);
    await db.query(
      `insert into "oauthAccessToken"
      select $1, 'retained-issued-access', 'retained-issued-refresh', now() + interval '1 hour',
        now() + interval '100 years', "clientId", "userId", scopes, now(), now()
      from "oauthAccessToken" where id = $2`,
      [crypto.randomUUID(), LEGACY_TOKEN_ID]
    );
    const { instance, request } = authForDatabase(db);
    expect(
      await instance.api.getMcpSession({
        headers: bearer("retained-issued-access"),
      })
    ).toMatchObject({ userId: AUTH_USER_ID, clientId: AUTH_CLIENT_ID });
    expect(
      await instance.api.getMcpSession({
        headers: bearer("legacy-access-token"),
      })
    ).toMatchObject({ userId: AUTH_USER_ID });
    expect(
      (await request(refreshRequest("retained-issued-refresh"))).status
    ).toBe(200);
  });

  it("keeps hosted refreshes long lived and CLI refreshes bounded to 30 days", async () => {
    await db.query(
      `insert into "oauthApplication" (id, name, "clientId", "redirectUrls", type, "userId", "createdAt", "updatedAt")
      values ($1, 'Mogplex CLI', 'mogplex-cli', 'http://127.0.0.1:24816/auth/callback', 'public', $2, now(), now())`,
      [crypto.randomUUID(), AUTH_USER_ID]
    );
    await db.query(
      `insert into "oauthAccessToken" select $1, 'cli-access', 'cli-refresh',
      "accessTokenExpiresAt", "refreshTokenExpiresAt", 'mogplex-cli', "userId", scopes, "createdAt", "updatedAt"
      from "oauthAccessToken" where id = $2`,
      [crypto.randomUUID(), LEGACY_TOKEN_ID]
    );
    await migrateAuth(db);
    const { request } = authForDatabase(db);
    expect((await request(refreshRequest())).status).toBe(200);
    expect(
      (await request(refreshRequest("cli-refresh", "mogplex-cli", ""))).status
    ).toBe(200);
    const tokens = (
      await db.query<{ clientId: string; seconds: number }>(`select "clientId",
      extract(epoch from ("expiresAt" - clock_timestamp()))::float8 as seconds from "oauthRefreshToken" where revoked is null`)
    ).rows;
    expect(
      tokens.find((r) => r.clientId === AUTH_CLIENT_ID)?.seconds
    ).toBeGreaterThan(99 * 365 * 86400);
    expect(
      tokens.find((r) => r.clientId === "mogplex-cli")?.seconds
    ).toBeGreaterThan(29 * 86400);
    expect(
      tokens.find((r) => r.clientId === "mogplex-cli")?.seconds
    ).toBeLessThanOrEqual(30 * 86400);
  });

  it("rejects wrong secrets, unknown clients, expired bearers and tampered JWT signatures", async () => {
    await migrateAuth(db);
    const { instance, request } = authForDatabase(db);
    for (const invalid of [
      refreshRequest(undefined, undefined, "wrong-secret"),
      refreshRequest(undefined, "unknown-client"),
    ]) {
      const denied = await request(invalid);
      expect([400, 401]).toContain(denied.status);
      expect(["invalid_client", "invalid_grant"]).toContain(
        (await denied.json()).error
      );
    }
    const token = await (await request(refreshRequest())).json();
    const [header, payload, signature] = token.access_token.split(".");
    const tampered = `${header}.${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    expect(
      await instance.api.getMcpSession({ headers: bearer(tampered) })
    ).toBeNull();
    await db.query(
      `update "oauthAccessTokenV2" set "expiresAt" = now() - interval '1 second'`
    );
    expect(
      await instance.api.getMcpSession({ headers: bearer(token.access_token) })
    ).toBeNull();
  });

  it("revokes the complete rotated family when the existing connection is deleted", async () => {
    await migrateAuth(db);
    const { instance, request } = authForDatabase(db);
    const token = await (await request(refreshRequest())).json();
    expect(
      await instance.api.getMcpSession({ headers: bearer(token.access_token) })
    ).not.toBeNull();
    await db.query(`delete from "oauthAccessToken" where id = $1`, [
      LEGACY_TOKEN_ID,
    ]);
    expect(
      await instance.api.getMcpSession({ headers: bearer(token.access_token) })
    ).toBeNull();
    expect((await request(refreshRequest(token.refresh_token))).status).toBe(
      400
    );
    const userinfo = await request(
      new Request("http://localhost:3000/api/auth/mcp/userinfo", {
        headers: bearer(token.access_token),
      })
    );
    expect(userinfo.status).toBe(401);
  });

  it("expires the old credential when the upgraded provider revokes its refresh", async () => {
    await migrateAuth(db);
    const { instance, request } = authForDatabase(db);
    const response = await request(
      new Request("http://localhost:3000/api/auth/oauth2/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: AUTH_CLIENT_ID,
          client_secret: AUTH_CLIENT_SECRET,
          token: "legacy-refresh-token",
          token_type_hint: "refresh_token",
        }),
      })
    );
    expect(response.status).toBe(200);
    const old = (
      await db.query<{
        expired: boolean;
      }>(`select "refreshTokenExpiresAt" <= clock_timestamp() and
      "accessTokenExpiresAt" <= clock_timestamp() as expired from "oauthAccessToken"`)
    ).rows[0];
    expect(old.expired).toBe(true);
    expect(
      await instance.api.getMcpSession({
        headers: bearer("legacy-access-token"),
      })
    ).toBeNull();
    await expect(
      db.query(`update "oauthAccessToken" set "accessToken" = 'resurrected',
      "accessTokenExpiresAt" = now() + interval '1 hour'`)
    ).rejects.toThrow("cannot be renewed");
  });

  it("propagates disabled clients and consent withdrawal in both directions", async () => {
    const consentId = crypto.randomUUID();
    await db.query(
      `insert into "oauthConsent" values ($1, $2, $3, 'read write', now(), now(), true)`,
      [consentId, AUTH_CLIENT_ID, AUTH_USER_ID]
    );
    await migrateAuth(db);
    expect(
      (
        await db.query<{ scopes: string }>(
          `select scopes from "oauthConsentV2"`
        )
      ).rows[0].scopes
    ).toBe('["read", "write"]');
    await db.query(`delete from "oauthConsentV2" where id = $1`, [consentId]);
    expect(
      (
        await db.query<{ consentGiven: boolean }>(
          `select "consentGiven" from "oauthConsent"`
        )
      ).rows[0].consentGiven
    ).toBe(false);
    await db.query(`update "oauthConsent" set "consentGiven" = true`);
    expect(
      (
        await db.query<{ n: number }>(
          `select count(*)::int as n from "oauthConsentV2"`
        )
      ).rows[0].n
    ).toBe(1);
    await db.query(`update "oauthApplication" set disabled = true`);
    const { instance, request } = authForDatabase(db);
    expect(
      await instance.api.getMcpSession({
        headers: bearer("legacy-access-token"),
      })
    ).toBeNull();
    const denied = await request(refreshRequest());
    expect([400, 401]).toContain(denied.status);
    expect((await denied.json()).error).toBe("invalid_client");
    await db.query(`update "oauthClient" set disabled = false`);
    expect(
      (
        await db.query<{ disabled: boolean }>(
          `select disabled from "oauthApplication"`
        )
      ).rows[0].disabled
    ).toBe(false);
  });

  it("denies credential tables and bridge helpers to Data API roles", async () => {
    await migrateAuth(db);
    await db.exec("reset role; set role anon");
    await expect(db.query(`select * from "oauthRefreshToken"`)).rejects.toThrow(
      "permission denied"
    );
    await expect(
      db.query(`select mogplex_auth.token_hash('a')`)
    ).rejects.toThrow("permission denied");
    await db.exec("reset role; set role authenticated");
    await expect(db.query(`select * from "oauthClient"`)).rejects.toThrow(
      "permission denied"
    );
  });

  it("replays a retried refresh safely and revokes its family after the replay window", async () => {
    await migrateAuth(db);
    const { instance, request } = authForDatabase(db);
    const first = await (await request(refreshRequest())).json();
    const retry = await request(refreshRequest());
    expect(retry.status).toBe(200);
    const repeated = await retry.json();
    expect(repeated.access_token).toBe(first.access_token);
    expect(repeated.refresh_token).toBe(first.refresh_token);
    await db.query(
      `update "oauthRefreshToken" set "rotationReplayExpiresAt" = now() - interval '1 second'
      where id = $1`,
      [LEGACY_TOKEN_ID]
    );
    const replay = await request(refreshRequest());
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("invalid_grant");
    expect(
      await instance.api.getMcpSession({ headers: bearer(first.access_token) })
    ).toBeNull();
  });

  it("does not allow an existing refresh grant to gain unapproved profile scopes", async () => {
    await migrateAuth(db);
    const { request } = authForDatabase(db);
    const initial = refreshRequest();
    const body = new URLSearchParams(await initial.text());
    body.set("scope", "read profile");
    const response = await request(
      new Request(initial.url, {
        method: "POST",
        headers: initial.headers,
        body,
      })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_scope");
  });
});
