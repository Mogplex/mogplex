import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  // The table as the baseline defines it, with a row from before the migration.
  await db.exec(`
    CREATE TABLE public.github_installations (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      user_id uuid NOT NULL,
      installation_id bigint NOT NULL,
      account_login text,
      account_type text,
      target_type text,
      permissions jsonb DEFAULT '{}'::jsonb NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      product_team_id uuid
    );
    INSERT INTO public.github_installations (user_id, installation_id, account_login)
    VALUES (gen_random_uuid(), 1, 'existing');
  `);
  await db.exec(
    await readFile(
      new URL(
        "../../neon/migrations/20261109181000_github_installation_repos_synced_at.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
});
afterAll(async () => db.close());

it("leaves existing installations unsynced", async () => {
  const { rows } = await db.query<{ repos_synced_at: Date | null }>(
    "SELECT repos_synced_at FROM public.github_installations WHERE account_login = 'existing'"
  );
  expect(rows).toEqual([{ repos_synced_at: null }]);
});

it("records a repository sync time", async () => {
  await db.query(
    "UPDATE public.github_installations SET repos_synced_at = '2026-11-09T12:00:00Z' WHERE installation_id = 1"
  );
  const { rows } = await db.query<{ repos_synced_at: Date }>(
    "SELECT repos_synced_at FROM public.github_installations WHERE installation_id = 1"
  );
  expect(rows[0].repos_synced_at.toISOString()).toBe(
    "2026-11-09T12:00:00.000Z"
  );
});

it("can be applied twice", async () => {
  await expect(
    db.exec(
      await readFile(
        new URL(
          "../../neon/migrations/20261109181000_github_installation_repos_synced_at.sql",
          import.meta.url
        ),
        "utf8"
      )
    )
  ).resolves.toBeDefined();
});
