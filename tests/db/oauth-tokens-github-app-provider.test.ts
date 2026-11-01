import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  // The table as the baseline defines it, before this migration, and a
  // stand-in for the vault the token functions read.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    CREATE SCHEMA vault;
    CREATE TABLE vault.secrets (id uuid PRIMARY KEY, secret text NOT NULL);
    CREATE VIEW vault.decrypted_secrets AS
      SELECT id, secret AS decrypted_secret FROM vault.secrets;
    CREATE TABLE public.oauth_tokens (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      user_id uuid NOT NULL,
      provider text NOT NULL,
      vault_secret_id uuid NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT oauth_tokens_provider_check CHECK ((provider = ANY (ARRAY['github'::text, 'vercel'::text])))
    );
    INSERT INTO public.oauth_tokens (user_id, provider, vault_secret_id)
    VALUES (gen_random_uuid(), 'github', gen_random_uuid());
  `);
  await db.exec(
    await readFile(
      new URL(
        "../../neon/migrations/20261101210000_oauth_tokens_github_app_provider.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
});
afterAll(async () => db.close());

function insert(provider: string) {
  return db.query(
    "INSERT INTO public.oauth_tokens (user_id, provider, vault_secret_id) VALUES (gen_random_uuid(), $1, gen_random_uuid())",
    [provider]
  );
}

it("stores a GitHub App user grant beside existing providers", async () => {
  await expect(insert("github_app")).resolves.toBeDefined();
  await expect(insert("vercel")).resolves.toBeDefined();
  const { rows } = await db.query<{ provider: string }>(
    "SELECT provider FROM public.oauth_tokens ORDER BY created_at, provider"
  );
  expect(rows.map((row) => row.provider)).toContain("github");
});

it("still rejects an unknown provider", async () => {
  await expect(insert("gitlab")).rejects.toThrow(/oauth_tokens_provider_check/);
});

async function storeGrant(value: string) {
  const userId = "00000000-0000-4000-8000-000000000001";
  const secretId = crypto.randomUUID();
  await db.query("DELETE FROM public.oauth_tokens WHERE user_id = $1", [
    userId,
  ]);
  await db.query("INSERT INTO vault.secrets (id, secret) VALUES ($1, $2)", [
    secretId,
    value,
  ]);
  await db.query(
    "INSERT INTO public.oauth_tokens (user_id, provider, vault_secret_id) VALUES ($1, 'github_app', $2)",
    [userId, secretId]
  );
  return userId;
}

async function deleteIfUnchanged(userId: string, expected: string) {
  const { rows } = await db.query<{ deleted: boolean }>(
    "SELECT public.delete_oauth_token_if_unchanged($1, 'github_app', $2) AS deleted",
    [userId, expected]
  );
  const remaining = await db.query(
    "SELECT 1 FROM public.oauth_tokens WHERE user_id = $1 AND provider = 'github_app'",
    [userId]
  );
  return { deleted: rows[0]?.deleted, remaining: remaining.rows.length };
}

it("keeps a grant another request replaced after the rejected refresh", async () => {
  const userId = await storeGrant('{"refreshToken":"ghr_winner"}');
  await expect(
    deleteIfUnchanged(userId, '{"refreshToken":"ghr_rejected"}')
  ).resolves.toEqual({ deleted: false, remaining: 1 });
});

it("forgets the grant GitHub rejected", async () => {
  const userId = await storeGrant('{"refreshToken":"ghr_rejected"}');
  await expect(
    deleteIfUnchanged(userId, '{"refreshToken":"ghr_rejected"}')
  ).resolves.toEqual({ deleted: true, remaining: 0 });
});
