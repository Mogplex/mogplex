import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  AUTH_CLIENT_ID,
  AUTH_CLIENT_SECRET,
  AUTH_USER_ID,
  authForDatabase,
  migrateAuth,
  oldAuthDatabase,
  refreshRequest,
} from "./helpers/better-auth-oauth-fixture";

let db: PGlite | undefined;
afterEach(async () => {
  await db?.close();
});

describe("credential-preserving Better Auth 1.7 migration", () => {
  it("uses the original confidential client contract rather than user-supplied metadata", async () => {
    db = await oldAuthDatabase();
    await db.query(
      `update "oauthApplication" set metadata = '{"token_endpoint_auth_method":"none","application_type":"invalid"}'`
    );
    await migrateAuth(db);
    const { request } = authForDatabase(db);
    const unsigned = await request(
      refreshRequest("legacy-refresh-token", AUTH_CLIENT_ID, "")
    );
    expect([400, 401]).toContain(unsigned.status);
    expect((await unsigned.json()).error).toBe("invalid_client");
    const response = await request(
      new Request("http://localhost:3000/api/auth/mcp/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${Buffer.from(`${AUTH_CLIENT_ID}:${AUTH_CLIENT_SECRET}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: "legacy-refresh-token",
        }),
      })
    );
    expect(response.status).toBe(200);
    expect((await response.json()).refresh_token).toBeTypeOf("string");
  });
  it("authenticates the original opaque bearer after migration", async () => {
    db = await oldAuthDatabase();
    await migrateAuth(db);
    const { instance } = authForDatabase(db);
    const session = await instance.api.getMcpSession({
      headers: new Headers({ authorization: "Bearer legacy-access-token" }),
    });
    expect(session).toEqual({
      clientId: AUTH_CLIENT_ID,
      userId: AUTH_USER_ID,
      scopes: "read write offline_access",
    });
  });

  it("rotates an existing hosted refresh token through its cached URL", async () => {
    db = await oldAuthDatabase();
    await migrateAuth(db);
    const { instance, request } = authForDatabase(db);
    const response = await request(refreshRequest());
    const body = await response.json();
    expect(body).not.toHaveProperty("error");
    expect(response.status).toBe(200);
    expect(body.refresh_token).toBeTypeOf("string");
    const session = await instance.api.getMcpSession({
      headers: new Headers({ authorization: `Bearer ${body.access_token}` }),
    });
    expect(session).toEqual({
      clientId: AUTH_CLIENT_ID,
      userId: AUTH_USER_ID,
      scopes: "read write offline_access",
    });
  });
});
