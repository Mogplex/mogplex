import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  PostgresDialect,
  type PostgresCursor,
  type PostgresQueryResult,
} from "kysely";
import { betterAuth } from "better-auth";
import { auth } from "@/lib/better-auth/server";
import { rewriteLegacyMcpRequest } from "@/lib/better-auth/mcp-request-compatibility";
import { legacyClientSecretMethod } from "@/lib/better-auth/mcp-client-auth-compatibility";

export const AUTH_SECRET = randomBytes(32).toString("hex");
export const AUTH_USER_ID = "00000000-0000-4000-8000-000000000011";
export const AUTH_CLIENT_ID = "hosted-mcp-client";
export const AUTH_CLIENT_SECRET = "old-confidential-client-secret";
export const AUTH_RESOURCE = "http://localhost:3000/api/v1/mogplex/mcp";
export const LEGACY_TOKEN_ID = "00000000-0000-4000-8000-000000000012";

export async function existingBrowserSession(db: PGlite) {
  const token = "legacy-browser-session-token";
  await db.query(
    `insert into "session" (id, token, "userId", "expiresAt", "createdAt", "updatedAt")
     values ('legacy-session-id', $1, $2, now() + interval '7 days', now(), now())`,
    [token, AUTH_USER_ID]
  );
  // The 1.6 cookie is token + HMAC-SHA256 in ordinary base64, URL encoded.
  const signature = createHmac("sha256", AUTH_SECRET)
    .update(token)
    .digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

const root = path.resolve(import.meta.dirname, "../../..");

/** Real PG SQL through Kysely; the mutex models PGlite's single connection. */
function dialect(db: PGlite) {
  let tail = Promise.resolve();
  function query<R>(
    sql: string,
    parameters: readonly unknown[]
  ): Promise<PostgresQueryResult<R>>;
  function query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  function query<R>(
    sql: string | PostgresCursor<R>,
    parameters?: readonly unknown[]
  ): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (typeof sql !== "string")
      throw new Error("The PG fixture does not support streaming cursors");
    return db
      .query<R>(sql, parameters ? [...parameters] : [])
      .then((result) => {
        const keyword = sql.trimStart().split(/\s+/, 1)[0].toUpperCase();
        const command =
          keyword === "INSERT" ||
          keyword === "DELETE" ||
          keyword === "UPDATE" ||
          keyword === "MERGE"
            ? keyword
            : "SELECT";
        return {
          rows: result.rows,
          rowCount: result.affectedRows ?? result.rows.length,
          command,
        };
      });
  }
  return new PostgresDialect({
    pool: {
      options: { max: 1 },
      async connect() {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        return {
          query,
          release,
        };
      },
      async end() {},
    },
  });
}

export async function oldAuthDatabase() {
  const db = new PGlite();
  const baseline = await readFile(path.join(root, "neon/baseline.sql"), "utf8");
  const tables = ["user", "session", "account", "verification", "ssoProvider"];
  for (const table of tables) {
    const name = `public\\.(?:"${table}"|${table})`;
    const create = baseline.match(
      new RegExp(`CREATE TABLE ${name} \\([\\s\\S]*?;`)
    )?.[0];
    if (!create) throw new Error(`Missing baseline auth table ${table}`);
    await db.exec(create);
  }
  for (const table of tables) {
    const name = `public\\.(?:"${table}"|${table})`;
    for (const constraint of baseline.matchAll(
      new RegExp(`ALTER TABLE ONLY ${name}\\s[\\s\\S]*?;`, "g")
    )) {
      await db.exec(constraint[0]);
    }
  }
  await db.exec(
    await readFile(
      path.join(
        root,
        "neon/migrations/20260805183000_better_auth_mcp_oauth.sql"
      ),
      "utf8"
    )
  );
  await db.exec(`
    create role service_role nologin bypassrls;
    create role anon nologin;
    create role authenticated nologin;
    grant usage on schema public to service_role;
    grant select, insert, update, delete on all tables in schema public to service_role;
  `);
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    values ($1, 'Existing user', 'existing@example.com', true, now(), now())`,
    [AUTH_USER_ID]
  );
  await db.query(
    `insert into "oauthApplication" (id, name, "clientId", "clientSecret", "redirectUrls", type,
      disabled, "userId", "createdAt", "updatedAt", metadata)
    values ($1, 'Existing hosted client', $2, $3, 'http://localhost:24816/auth/callback', 'web', false,
      $4, now(), now(), null)`,
    [crypto.randomUUID(), AUTH_CLIENT_ID, AUTH_CLIENT_SECRET, AUTH_USER_ID]
  );
  await db.query(
    `insert into "oauthAccessToken" (id, "accessToken", "refreshToken", "accessTokenExpiresAt",
      "refreshTokenExpiresAt", "clientId", "userId", scopes, "createdAt", "updatedAt")
    values ($1, 'legacy-access-token', 'legacy-refresh-token', now() + interval '1 hour',
      now() + interval '100 years', $2, $3, 'read write offline_access', now(), now())`,
    [LEGACY_TOKEN_ID, AUTH_CLIENT_ID, AUTH_USER_ID]
  );
  return db;
}

export async function migrateAuth(db: PGlite) {
  for (const file of [
    "20261029150000_better_auth_17_storage.sql",
    "20261029151000_preserve_legacy_oauth_credentials.sql",
  ]) {
    const sql = await readFile(
      path.join(root, "neon/migrations", file),
      "utf8"
    );
    await db.transaction((tx) => tx.exec(sql));
  }
  await db.exec("set role service_role");
}

export function authForDatabase(db: PGlite) {
  const instance = betterAuth({
    ...auth.options,
    secret: AUTH_SECRET,
    advanced: {
      ...auth.options.advanced,
      database: { ...auth.options.advanced?.database, validateSchema: true },
    },
    database: { dialect: dialect(db), type: "postgres" },
  });
  return {
    instance,
    async request(request: Request) {
      return instance.handler(
        await rewriteLegacyMcpRequest(
          request,
          AUTH_RESOURCE,
          async (clientId) =>
            legacyClientSecretMethod(
              (await instance.$context).adapter,
              clientId
            )
        )
      );
    },
  };
}

export function refreshRequest(
  token = "legacy-refresh-token",
  clientId = AUTH_CLIENT_ID,
  secret = AUTH_CLIENT_SECRET
) {
  return new Request("http://localhost:3000/api/auth/mcp/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token,
      client_id: clientId,
      client_secret: secret,
    }),
  });
}
