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
  await db.exec(
    await readFile(
      new URL(
        "../../neon/migrations/20261002021000_reserve_current_routes.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
});
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
