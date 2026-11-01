import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { RESERVED_SLUGS } from "../../lib/reserved-slugs";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  const previous = await readFile(
    new URL(
      "../../neon/migrations/20260804180000_reserve_pricing_slug.sql",
      import.meta.url
    ),
    "utf8"
  );
  await db.exec(previous.split("-- Resolve pre-existing collisions")[0]);
  // The collision rename needs the identity tables; it has its own case.
  await db.exec(
    (await currentMigration()).split("-- Resolve pre-existing collisions")[0]
  );
});

async function currentMigration() {
  return readFile(
    new URL(
      "../../neon/migrations/20261101200000_reserve_monitoring_slug.sql",
      import.meta.url
    ),
    "utf8"
  );
}
afterAll(async () => db.close());

it("rejects every application-reserved slug at the database boundary", async () => {
  const values = [...RESERVED_SLUGS].flatMap((slug) => [
    slug,
    slug.toUpperCase(),
  ]);
  const result = await db.query<{ value: string; reserved: boolean }>(
    "SELECT value, public.is_reserved_slug(value) AS reserved FROM unnest($1::text[]) AS value",
    [values]
  );
  expect(result.rows.filter((row) => !row.reserved)).toEqual([]);
});
it("allows ordinary personal and team slugs", async () => {
  const result = await db.query<{ reserved: boolean }>(
    "SELECT public.is_reserved_slug('acme-design') AS reserved"
  );
  expect(result.rows[0].reserved).toBe(false);
});

it("renames an existing owner of the newly reserved slug", async () => {
  await db.exec(`
    CREATE TABLE public.profiles (id text PRIMARY KEY, slug text);
    CREATE TABLE public.teams (id text PRIMARY KEY, slug text, updated_at timestamptz);
    INSERT INTO public.profiles VALUES ('p1', 'monitoring'), ('p2', 'monitoring-2');
    INSERT INTO public.teams VALUES ('t1', 'monitoring', NULL);
  `);

  await db.exec(await currentMigration());

  const result = await db.query<{ id: string; slug: string }>(
    "SELECT id, slug FROM public.profiles UNION ALL SELECT id, slug FROM public.teams ORDER BY id"
  );
  expect(result.rows).toEqual([
    { id: "p1", slug: "monitoring-3" },
    { id: "p2", slug: "monitoring-2" },
    { id: "t1", slug: "monitoring-4" },
  ]);
});
