import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  // The table as the baseline defines it, before this migration.
  await db.exec(`
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
