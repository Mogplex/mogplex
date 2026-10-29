import { createHash } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readOAuthConsent } from "@/lib/better-auth/oauth-consent";
import {
  AUTH_CLIENT_ID,
  AUTH_CLIENT_SECRET,
  AUTH_SECRET,
  AUTH_USER_ID,
  AUTH_RESOURCE,
  authForDatabase,
  existingBrowserSession,
  migrateAuth,
  oldAuthDatabase,
  refreshRequest,
} from "./helpers/better-auth-oauth-fixture";

let db: PGlite;
let cookie: string;
const callback = "http://localhost:24816/auth/callback";
const verifier = "a-real-pkce-verifier-at-least-43-characters-long-123456789";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const consentRequest = () =>
  new Request("http://localhost:3000/api/auth/oauth2/consent", {
    method: "POST",
    headers: { cookie },
  });
const authorize = (extra: Record<string, string> = {}, withCookie = true) =>
  new Request(
    `http://localhost:3000/api/auth/mcp/authorize?${new URLSearchParams({
      client_id: AUTH_CLIENT_ID,
      response_type: "code",
      redirect_uri: callback,
      scope: "openid profile email offline_access read write",
      state: "original-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...extra,
    })}`,
    { headers: withCookie ? { cookie } : {} }
  );

beforeEach(async () => {
  db = await oldAuthDatabase();
  cookie = await existingBrowserSession(db);
  await migrateAuth(db);
});
afterEach(async () => {
  await db.close();
});

describe("cached and fresh MCP authorization", () => {
  it("preserves the existing auth-rate policy when several MCP clients register", async () => {
    const { request } = authForDatabase(db, {
      enabled: true,
      storage: "memory",
      window: 10,
      max: 100,
    });
    for (let index = 0; index < 6; index++) {
      const response = await request(
        new Request("http://localhost:3000/api/auth/mcp/register", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "198.51.100.42",
          },
          body: JSON.stringify({
            client_name: `MCP client ${index}`,
            redirect_uris: ["https://client.example/callback"],
            token_endpoint_auth_method: "none",
          }),
        })
      );
      expect(response.status).toBe(201);
    }
  });

  it("preserves the existing auth-rate policy during a burst of refresh retries", async () => {
    const { request } = authForDatabase(db, {
      enabled: true,
      storage: "memory",
      window: 10,
      max: 100,
    });
    for (let index = 0; index < 21; index++) {
      const retry = refreshRequest();
      retry.headers.set("x-forwarded-for", "198.51.100.43");
      expect((await request(retry)).status).toBe(200);
    }
  });
  it("retains login context and requires explicit consent before issuing a code", async () => {
    const { request } = authForDatabase(db);
    const loggedOut = await request(authorize({}, false));
    expect(loggedOut.status).toBe(302);
    const login = new URL(
      loggedOut.headers.get("location")!,
      "http://localhost:3000"
    );
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("client_id")).toBe(AUTH_CLIENT_ID);
    const response = await request(authorize());
    expect(response.status).toBe(302);
    const consent = new URL(
      response.headers.get("location")!,
      "http://localhost:3000"
    );
    expect(consent.pathname).toBe("/oauth/consent");
    expect(
      await readOAuthConsent(consent.search.slice(1), AUTH_SECRET)
    ).toMatchObject({
      clientId: AUTH_CLIENT_ID,
      scopes: ["openid", "profile", "email", "offline_access", "read", "write"],
    });
    expect(
      await readOAuthConsent(
        `${consent.search.slice(1)}&scope=write`,
        AUTH_SECRET
      )
    ).toBeNull();
  });

  it("completes consent and PKCE with the existing client and preserves state and identity", async () => {
    const { instance, request } = authForDatabase(db);
    const initial = await request(authorize());
    const consent = new URL(
      initial.headers.get("location")!,
      "http://localhost:3000"
    );
    const result = await instance.api.oauth2Consent({
      asResponse: false,
      request: consentRequest(),
      headers: new Headers({ cookie }),
      body: { accept: true, oauth_query: consent.search.slice(1) },
    });
    const redirect = new URL(result.url);
    expect(redirect.origin + redirect.pathname).toBe(callback);
    expect(redirect.searchParams.get("state")).toBe("original-state");
    const code = redirect.searchParams.get("code")!;
    expect(code).toBeTruthy();
    const tokenRequest = () =>
      new Request("http://localhost:3000/api/auth/mcp/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: AUTH_CLIENT_ID,
          client_secret: AUTH_CLIENT_SECRET,
          code,
          redirect_uri: callback,
          code_verifier: verifier,
        }),
      });
    const exchange = await request(tokenRequest());
    const tokens = await exchange.json();
    expect(tokens.error).toBeUndefined();
    expect(exchange.status).toBe(200);
    expect(tokens.refresh_token).toBeTypeOf("string");
    expect(tokens.id_token).toBeTypeOf("string");
    expect(decodeProtectedHeader(tokens.access_token).alg).toBe("RS256");
    expect(decodeJwt(tokens.access_token).iss).toBe("http://localhost:3000");
    expect([decodeJwt(tokens.access_token).aud].flat()).toContain(
      AUTH_RESOURCE
    );
    expect(
      await instance.api.getMcpSession({
        headers: new Headers({
          authorization: `Bearer ${tokens.access_token}`,
        }),
      })
    ).toEqual({
      clientId: AUTH_CLIENT_ID,
      userId: AUTH_USER_ID,
      scopes: "openid profile email offline_access read write",
    });
    const revoked = await request(
      new Request("http://localhost:3000/api/auth/oauth2/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: AUTH_CLIENT_ID,
          client_secret: AUTH_CLIENT_SECRET,
          token: tokens.refresh_token,
          token_type_hint: "refresh_token",
        }),
      })
    );
    expect(revoked.status).toBe(200);
    expect(
      await instance.api.getMcpSession({
        headers: new Headers({
          authorization: `Bearer ${tokens.access_token}`,
        }),
      })
    ).toBeNull();
    const replay = await request(tokenRequest());
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("invalid_grant");
  });

  it("returns access_denied with the original state when the user cancels", async () => {
    const { instance, request } = authForDatabase(db);
    const initial = await request(authorize());
    const query = new URL(
      initial.headers.get("location")!,
      "http://localhost:3000"
    ).search.slice(1);
    const result = await instance.api.oauth2Consent({
      asResponse: false,
      request: consentRequest(),
      headers: new Headers({ cookie }),
      body: { accept: false, oauth_query: query },
    });
    expect(new URL(result.url).searchParams.get("error")).toBe("access_denied");
    expect(new URL(result.url).searchParams.get("state")).toBe(
      "original-state"
    );
    expect(
      (
        await db.query<{ n: number }>(
          `select count(*)::int as n from "oauthConsentV2"`
        )
      ).rows[0].n
    ).toBe(0);
  });

  it("rejects an unregistered redirect, missing PKCE and a forged consent query", async () => {
    const { instance, request } = authForDatabase(db);
    const redirect = await request(
      authorize({ redirect_uri: "https://attacker.example/callback" })
    );
    expect(redirect.status).toBe(302);
    const safeError = new URL(
      redirect.headers.get("location")!,
      "http://localhost:3000"
    );
    expect(safeError.origin).toBe("http://localhost:3000");
    expect(safeError.searchParams.get("error")).toBeTruthy();
    const noPkce = await request(
      authorize({ code_challenge: "", code_challenge_method: "" })
    );
    expect(noPkce.status).toBeGreaterThanOrEqual(300);
    expect(
      noPkce.headers.get("location") ?? (await noPkce.text())
    ).not.toContain("code=");
    await expect(
      instance.api.oauth2Consent({
        headers: new Headers({ cookie }),
        body: {
          accept: true,
          oauth_query: `client_id=${AUTH_CLIENT_ID}&redirect_uri=https://attacker.example`,
        },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("dynamically registers a PKCE client through the cached registration URL", async () => {
    const { request } = authForDatabase(db);
    const registration = await request(
      new Request("http://localhost:3000/api/auth/mcp/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "New MCP client",
          redirect_uris: ["https://client.example/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          scope: "read write offline_access",
        }),
      })
    );
    const client = await registration.json();
    expect(client.error).toBeUndefined();
    expect(registration.status).toBe(201);
    expect(client.client_id).toBeTypeOf("string");
    expect(client.token_endpoint_auth_method).toBe("none");
    expect(client).not.toHaveProperty("client_secret");
    const stored = await db.query<{ legacySecretMethods: boolean }>(
      `select "legacySecretMethods" from "oauthClient" where "clientId" = $1`,
      [client.client_id]
    );
    expect(stored.rows[0].legacySecretMethods).toBe(false);
    const withoutPkce = await request(
      authorize({
        client_id: client.client_id,
        redirect_uri: "https://client.example/callback",
        code_challenge: "",
        code_challenge_method: "",
      })
    );
    const target = new URL(
      withoutPkce.headers.get("location")!,
      "http://localhost:3000"
    );
    expect(target.searchParams.get("error")).toBeTruthy();
    expect(target.searchParams.has("code")).toBe(false);
  });
});
