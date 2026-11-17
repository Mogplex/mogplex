import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { COMMIT_SIGNING_ENCRYPTION_ENV } from "@/lib/commit-signing/secret-box";
import { generateCommitSigningKeyPair } from "@/lib/commit-signing/key-material";
import {
  saveCommitSigningKey,
  getCommitSigningKey,
  getCommitSigningKeyView,
  readCommitSigningPrivateKey,
  markCommitSigningKeyRegistered,
  clearCommitSigningKeyRegistration,
  deleteCommitSigningKey,
} from "@/lib/commit-signing/storage";

const owner = "00000000-0000-4000-8000-000000000031";
const other = "00000000-0000-4000-8000-000000000032";
let db: PGlite;
const previousFrom = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");

beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  await db.exec("create role anon; create role authenticated;");
  expect(
    (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
  ).toBe(true);
  await db.query("insert into profiles(id) values ($1), ($2)", [owner, other]);
  const shim = createPostgrestShim({
    query: async (text, values) => {
      const result = await db.query(text, values);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  });
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value: shim.from.bind(shim),
  });
  vi.stubEnv(
    COMMIT_SIGNING_ENCRYPTION_ENV,
    "fixture-only-signing-encryption-secret"
  );
}, 120_000);

afterAll(async () => {
  if (previousFrom) Object.defineProperty(supabaseAdmin, "from", previousFrom);
  else Reflect.deleteProperty(supabaseAdmin, "from");
  vi.unstubAllEnvs();
  await db.close();
});

it("keeps keys encrypted and user-scoped through save, replacement, registration, and deletion", async () => {
  const pair = generateCommitSigningKeyPair();
  const publicView = await saveCommitSigningKey({ userId: owner, ...pair });
  expect(JSON.stringify(publicView)).not.toContain("PRIVATE KEY");
  const stored = await getCommitSigningKey(owner);
  expect(stored?.encrypted_private_key).not.toContain(pair.privateKey);
  expect(await readCommitSigningPrivateKey(stored!)).toBe(pair.privateKey);
  expect(await getCommitSigningKeyView(other)).toBeNull();
  await markCommitSigningKeyRegistered({
    userId: owner,
    publicKey: pair.publicKey,
    githubKeyId: "42",
    title: "Signing",
  });
  expect(await getCommitSigningKeyView(owner)).toMatchObject({
    githubKeyId: "42",
    title: "Signing",
  });
  await clearCommitSigningKeyRegistration(owner);
  expect(await getCommitSigningKeyView(owner)).toMatchObject({
    githubKeyId: null,
    registeredAt: null,
  });
  const replacement = generateCommitSigningKeyPair();
  await saveCommitSigningKey({ userId: owner, ...replacement });
  // GitHub can finish registering the previous key after another tab
  // replaces it. That delayed response must not certify the replacement.
  await markCommitSigningKeyRegistered({
    userId: owner,
    publicKey: pair.publicKey,
    githubKeyId: "stale-registration",
  });
  expect(await getCommitSigningKeyView(owner)).toMatchObject({
    publicKey: replacement.publicKey,
    registeredAt: null,
  });
  await deleteCommitSigningKey(other);
  expect(await getCommitSigningKeyView(owner)).not.toBeNull();
  await deleteCommitSigningKey(owner);
  expect(await getCommitSigningKeyView(owner)).toBeNull();
});

it("denies direct end-user access while granting the server role access", async () => {
  const result = await db.query<{ role: string; readable: boolean }>(
    "select rolname as role, has_table_privilege(rolname, 'public.commit_signing_keys', 'select') as readable from pg_roles where rolname in ('anon', 'authenticated', 'service_role')"
  );
  expect(result.rows.find((row) => row.role === "service_role")?.readable).toBe(
    true
  );
  expect(result.rows).toHaveLength(3);
  for (const row of result.rows.filter((row) => row.role !== "service_role"))
    expect(row.readable).toBe(false);
  expect(
    (
      await db.query<{ enabled: boolean }>(
        "select relrowsecurity as enabled from pg_class where oid = 'public.commit_signing_keys'::regclass"
      )
    ).rows[0]?.enabled
  ).toBe(true);
});
