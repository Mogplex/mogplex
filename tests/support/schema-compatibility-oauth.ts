import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { getAuthTables } from "better-auth/db";
import { auth } from "@/lib/better-auth/server";
import type { Queryable } from "@/lib/db/postgrest-shim";

const userId = "00000000-0000-4000-8000-000000000031";
const tokenId = "00000000-0000-4000-8000-000000000032";
const clientId = "retained-release-mcp";
const clientSecret = "retained-release-fixture-secret";

export async function seedOAuthCompatibility(db: Queryable) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    values ($1, 'Retained OAuth user', 'retained-oauth@example.test', true, now(), now())`,
    [userId]
  );
  await db.query(
    `insert into "oauthApplication" (id, name, "clientId", "clientSecret", "redirectUrls", type, disabled, "userId", "createdAt", "updatedAt")
    values ($1, 'Retained MCP', $2, $3, 'https://retained.example/callback', 'web', false, $4, now(), now())`,
    [crypto.randomUUID(), clientId, clientSecret, userId]
  );
  await db.query(
    `insert into "oauthAccessToken" (id, "accessToken", "refreshToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "clientId", "userId", scopes, "createdAt", "updatedAt")
    values ($1, 'retained-bearer', 'retained-refresh', now() + interval '1 hour', now() + interval '100 years', $2, $3, 'read write offline_access', now(), now())`,
    [tokenId, clientId, userId]
  );
  await db.query(
    `insert into "oauthConsent" values ($1, $2, $3, 'read write offline_access', now(), now(), true)`,
    [crypto.randomUUID(), clientId, userId]
  );
}

function dateFields(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value && (key.endsWith("At") || key === "revoked")
        ? new Date(String(value))
        : value,
    ])
  );
}

async function authRows(db: Queryable) {
  const records: Record<string, Record<string, unknown>[]> = {};
  for (const table of Object.values(getAuthTables(auth.options))) {
    const name = table.modelName;
    assert.match(name, /^[a-zA-Z][a-zA-Z0-9]*$/);
    records[name] = (await db.query(`select * from "${name}"`)).rows.map(
      (row) => {
        const result = dateFields(row);
        for (const [field, definition] of Object.entries(table.fields)) {
          const column = definition.fieldName ?? field;
          if (
            definition.type === "string[]" &&
            typeof result[column] === "string"
          )
            result[column] = JSON.parse(result[column] as string);
        }
        return result;
      }
    );
  }
  return records;
}

/** This entire module runs with the previous release's SDK and auth options. */
export async function verifyOAuthCompatibility(db: Queryable) {
  const original = (
    await db.query(`select * from "oauthAccessToken" where id = $1`, [tokenId])
  ).rows[0];
  assert.equal(original.accessToken, "retained-bearer");
  assert.equal(original.refreshToken, "retained-refresh");
  assert.equal(original.scopes, "read write offline_access");
  assert.ok(
    new Date(String(original.refreshTokenExpiresAt)).getFullYear() >=
      new Date().getFullYear() + 99
  );
  const client = (
    await db.query(`select * from "oauthApplication" where "clientId" = $1`, [
      clientId,
    ])
  ).rows[0];
  assert.equal(client.clientSecret, clientSecret);
  assert.equal(client.redirectUrls, "https://retained.example/callback");
  assert.equal(client.disabled, false);
  const consent = (
    await db.query(`select * from "oauthConsent" where "clientId" = $1`, [
      clientId,
    ])
  ).rows[0];
  assert.equal(consent.consentGiven, true);

  // Load real persisted rows at the adapter boundary. The retained SDK owns
  // interpretation and expiry checks; no candidate auth code is substituted.
  const instance = betterAuth({
    ...auth.options,
    database: memoryAdapter(await authRows(db)),
  });
  const session = await instance.api.getMcpSession({
    headers: new Headers({ authorization: "Bearer retained-bearer" }),
  });
  assert.equal(session?.clientId, clientId);
  assert.equal(session?.userId, userId);
  assert.equal(session?.scopes, "read write offline_access");

  // The 1.6 refresh handler INSERTs another token row, retaining the original.
  // Exercise that exact old storage contract after the candidate migration.
  const nextTokenId = crypto.randomUUID();
  await db.query(
    `insert into "oauthAccessToken" select $1, 'retained-next-bearer', 'retained-next-refresh',
      now() + interval '1 hour', now() + interval '100 years', "clientId", "userId", scopes, now(), now()
      from "oauthAccessToken" where id = $2`,
    [nextTokenId, tokenId]
  );
  const rotated = (
    await db.query(
      `select "accessToken", "refreshToken" from "oauthAccessToken" where id = $1`,
      [nextTokenId]
    )
  ).rows[0];
  assert.deepEqual(rotated, {
    accessToken: "retained-next-bearer",
    refreshToken: "retained-next-refresh",
  });
  const refreshedInstance = betterAuth({
    ...auth.options,
    database: memoryAdapter(await authRows(db)),
  });
  const refreshed = await refreshedInstance.api.getMcpSession({
    headers: new Headers({ authorization: "Bearer retained-next-bearer" }),
  });
  assert.equal(refreshed?.userId, userId);
  assert.equal(refreshed?.scopes, "read write offline_access");
  await db.query(`delete from "oauthAccessToken" where id in ($1, $2)`, [
    tokenId,
    nextTokenId,
  ]);
  assert.equal(
    (
      await db.query(`select id from "oauthAccessToken" where id = $1`, [
        tokenId,
      ])
    ).rows.length,
    0
  );
}
