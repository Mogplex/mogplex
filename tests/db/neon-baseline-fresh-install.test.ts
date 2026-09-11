import { readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { describe, expect, it } from "vitest";
import { migrationVersion } from "@/lib/db/neon-baseline";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const migrationsDir = path.join(REPO_ROOT, "neon", "migrations");
const baselinePath = path.join(REPO_ROOT, "neon", "baseline.sql");
const BOOTSTRAP_TIMEOUT_MS = 60_000;

// The baseline is a real pg_dump, so the test database needs the same
// extensions the production database has.
function createDb() {
  return PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
}

function runner(db: PGlite) {
  const output: string[] = [];
  const record = (message: string) => {
    output.push(message);
  };
  return {
    output,
    apply: (dryRun = false) =>
      applyNeonMigrations(db, {
        dryRun,
        migrationsDir,
        baselinePath,
        log: record,
        warn: record,
      }),
  };
}

async function migrationVersionsOnDisk() {
  return (await readdir(migrationsDir))
    .map((fileName) => migrationVersion(fileName))
    .filter((version): version is string => version !== null)
    .sort();
}

async function ledgerVersions(db: PGlite) {
  const { rows } = await db.query<{ version: string }>(
    "select version from neon_migrations.schema_migrations order by version"
  );
  return rows.map((row) => row.version);
}

async function publicTableCount(db: PGlite) {
  const { rows } = await db.query<{ count: number }>(
    "select count(*)::int as count from pg_catalog.pg_tables where schemaname = 'public'"
  );
  return rows[0].count;
}

describe("fresh-install bootstrap", () => {
  it(
    "builds an empty database from the baseline, records every migration, and is idempotent",
    async () => {
      const db = await createDb();
      const { apply, output } = runner(db);

      const first = await apply();
      expect(first).toMatchObject({ ok: true, baseline: "applied" });
      expect(first.applied).toEqual([]);
      expect(await ledgerVersions(db)).toEqual(await migrationVersionsOnDisk());

      const { rows: tables } = await db.query<{ found: boolean }>(
        "select to_regclass('public.profiles') is not null as found"
      );
      expect(tables[0].found).toBe(true);
      const { rows: roles } = await db.query<{ rolname: string }>(
        "select rolname from pg_catalog.pg_roles where rolname in ('service_role', 'supabase_auth_admin') order by 1"
      );
      expect(roles.map((row) => row.rolname)).toEqual([
        "service_role",
        "supabase_auth_admin",
      ]);
      expect(output.some((line) => line.startsWith("failed"))).toBe(false);

      const second = await apply();
      expect(second).toEqual({ ok: true, baseline: "skipped", applied: [] });
      await db.close();
    },
    BOOTSTRAP_TIMEOUT_MS
  );

  it("dry run reports the bootstrap without changing the database", async () => {
    const db = await createDb();
    const { apply, output } = runner(db);

    const result = await apply(true);
    expect(result).toMatchObject({ ok: true, baseline: "planned" });
    expect(output.join("\n")).toContain("would apply baseline.sql");
    expect(await publicTableCount(db)).toBe(0);
    expect(await ledgerVersions(db)).toEqual([]);
    await db.close();
  });

  it("never applies the baseline over a database that already has tables", async () => {
    const db = await createDb();
    await db.exec("create table public.profiles (id uuid primary key)");
    const { apply } = runner(db);

    const result = await apply(true);
    expect(result.baseline).toBe("skipped");
    expect(result.applied.length).toBeGreaterThan(0);
    expect(await publicTableCount(db)).toBe(1);
    await db.close();
  });
});
