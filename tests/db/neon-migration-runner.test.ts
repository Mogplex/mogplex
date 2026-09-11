import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, expect, it } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixture(baseline?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "neon-runner-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const migrationsDir = path.join(root, "migrations");
  const baselinePath = path.join(root, "baseline.sql");
  await mkdir(migrationsDir);
  if (baseline !== undefined) {
    await writeFile(
      baselinePath,
      `-- baseline-through: 20260101000000\n${baseline}`
    );
  }
  const db = await PGlite.create();
  cleanups.push(() => db.close());
  const messages: string[] = [];
  const record = (message: string) => {
    messages.push(message);
  };
  return {
    db,
    messages,
    write: (name: string, sql: string) =>
      writeFile(path.join(migrationsDir, name), sql),
    apply: (dryRun = false) =>
      applyNeonMigrations(db, {
        migrationsDir,
        baselinePath,
        dryRun,
        log: record,
        warn: record,
      }),
  };
}

it.each(['"$user", public', "custom, public"])(
  "restores search_path %s before applying migrations newer than the baseline",
  async (searchPath) => {
    const { db, write, apply } = await fixture(
      "SELECT pg_catalog.set_config('search_path', '', false); CREATE TABLE public.baseline_table (id int);"
    );
    await db.exec("create schema custom");
    await db.query("select set_config('search_path', $1, false)", [searchPath]);
    await write("20260101000000_seed.sql", "select 1");
    await write("20260102000000_pending.sql", "create table example (id uuid)");
    expect(await apply()).toEqual({
      ok: true,
      baseline: "applied",
      applied: ["20260102000000_pending.sql"],
    });
    expect((await db.query("show search_path")).rows).toEqual([
      { search_path: searchPath },
    ]);
    expect(
      (await db.query("select to_regclass('example')::text as name")).rows
    ).toEqual([{ name: "example" }]);
    expect(
      (
        await db.query(
          "select count(*)::int as count from neon_migrations.schema_migrations"
        )
      ).rows
    ).toEqual([{ count: 2 }]);
    expect(await apply()).toEqual({
      ok: true,
      baseline: "skipped",
      applied: [],
    });
  }
);

it("rolls back a failed baseline without recording versions or leaking session settings", async () => {
  const { db, write, apply, messages } = await fixture(
    "SELECT set_config('search_path', '', false); CREATE TABLE public.partial (id int); SELECT missing_function();"
  );
  const originalSearchPath = (await db.query("show search_path")).rows;
  await write("20260101000000_seed.sql", "select 1");
  expect(await apply()).toEqual({
    ok: false,
    baseline: "skipped",
    applied: [],
    failed: "baseline.sql",
  });
  expect(
    (await db.query("select to_regclass('public.partial') as name")).rows
  ).toEqual([{ name: null }]);
  expect(
    (await db.query("select * from neon_migrations.schema_migrations")).rows
  ).toEqual([]);
  expect((await db.query("show search_path")).rows).toEqual(originalSearchPath);
  expect(messages.join("\n")).toContain("failed applying baseline");
});

it("applies migrations without a baseline and rolls back only the failed migration", async () => {
  const { db, write, apply, messages } = await fixture();
  await write("README.md", "not a migration");
  await write("20260101000000_first.sql", "create table first_table (id int)");
  await write(
    "20260102000000_broken.sql",
    "create table partial (id int); select missing_function()"
  );
  expect(await apply()).toEqual({
    ok: false,
    baseline: "skipped",
    applied: ["20260101000000_first.sql"],
    failed: "20260102000000_broken.sql",
  });
  expect(
    (await db.query("select version from neon_migrations.schema_migrations"))
      .rows
  ).toEqual([{ version: "20260101000000" }]);
  expect(
    (await db.query("select to_regclass('partial') as name")).rows
  ).toEqual([{ name: null }]);
  expect(messages.join("\n")).toContain(
    "skipping non-migration file: README.md"
  );
  expect(messages.join("\n")).toContain("empty database and no baseline");
  await write("20260102000000_broken.sql", "create table repaired (id int)");
  expect(await apply()).toEqual({
    ok: true,
    baseline: "skipped",
    applied: ["20260102000000_broken.sql"],
  });
});
