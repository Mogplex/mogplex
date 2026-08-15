import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATION =
  "neon/migrations/20260814235500_enforce_password_hash_storage.sql";
const VALID_HASH = `${"a".repeat(32)}:${"b".repeat(128)}`;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table "user" (
      "id" text primary key
    );
    create table "session" (
      "id" text primary key,
      "userId" text not null references "user" ("id") on delete cascade
    );
    create table "account" (
      "id" text primary key,
      "providerId" text not null,
      "userId" text not null references "user" ("id") on delete cascade,
      "password" text,
      "updatedAt" timestamptz not null
    );

    insert into "user" ("id") values ('safe-user'), ('unsafe-user');
    insert into "session" ("id", "userId") values
      ('safe-session', 'safe-user'),
      ('unsafe-session', 'unsafe-user');
    insert into "account" (
      "id", "providerId", "userId", "password", "updatedAt"
    ) values
      ('safe-account', 'credential', 'safe-user', '${VALID_HASH}', now()),
      ('unsafe-account', 'credential', 'unsafe-user', 'plaintext-password', now());
  `);

  const sql = await readFile(path.join(REPO_ROOT, MIGRATION), "utf8");
  await db.exec(sql);
});

afterAll(async () => {
  await db.close();
});

describe("Better Auth password storage migration", () => {
  it("scrubs non-hash credential values and revokes affected sessions", async () => {
    const { rows: accounts } = await db.query<{
      id: string;
      password: string | null;
    }>(`select "id", "password" from "account" order by "id"`);
    expect(accounts).toEqual([
      { id: "safe-account", password: VALID_HASH },
      { id: "unsafe-account", password: null },
    ]);

    const { rows: sessions } = await db.query<{ id: string }>(
      `select "id" from "session" order by "id"`
    );
    expect(sessions).toEqual([{ id: "safe-session" }]);
  });

  it("blocks future plaintext credential writes at the database boundary", async () => {
    await expect(
      db.exec(`
        insert into "account" (
          "id", "providerId", "userId", "password", "updatedAt"
        ) values (
          'new-unsafe-account', 'credential', 'safe-user',
          'another-plaintext-password', now()
        )
      `)
    ).rejects.toThrow(/account_credential_password_hash_check/);

    await expect(
      db.exec(`
        insert into "account" (
          "id", "providerId", "userId", "password", "updatedAt"
        ) values (
          'new-safe-account', 'credential', 'safe-user', '${VALID_HASH}', now()
        )
      `)
    ).resolves.not.toThrow();
  });

  it("installs a validated, idempotent constraint", async () => {
    const sql = await readFile(path.join(REPO_ROOT, MIGRATION), "utf8");
    await expect(db.exec(sql)).resolves.not.toThrow();

    const { rows } = await db.query<{ convalidated: boolean }>(`
      select convalidated
      from pg_constraint
      where conname = 'account_credential_password_hash_check'
    `);
    expect(rows).toEqual([{ convalidated: true }]);
  });
});
