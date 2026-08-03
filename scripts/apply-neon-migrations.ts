// Applies neon/migrations/*.sql in filename order against DATABASE_URL,
// tracking applied versions in neon_migrations.schema_migrations (the same
// ledger the manual applies used). Each migration runs in its own
// transaction: statements that cannot run inside one (CREATE INDEX
// CONCURRENTLY, …) must be applied out of band, same rule as the Supabase
// pipeline.
//
// Usage: pnpm exec tsx scripts/apply-neon-migrations.ts [--dry-run]
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const MIGRATIONS_DIR = path.join(process.cwd(), "neon", "migrations");
const VERSION_PATTERN = /^(\d{14})_[\w-]+\.sql$/;

async function applyPending(pool: Pool, dryRun: boolean): Promise<boolean> {
  await pool.query(`create schema if not exists neon_migrations`);
  await pool.query(
    `create table if not exists neon_migrations.schema_migrations (
       version text primary key,
       applied_at timestamptz not null default now()
     )`
  );

  const entries = [...(await readdir(MIGRATIONS_DIR))].sort();
  const applied = new Set(
    (
      await pool.query(`select version from neon_migrations.schema_migrations`)
    ).rows.map((row) => String(row.version))
  );

  let ran = 0;
  for (const entry of entries) {
    const match = entry.match(VERSION_PATTERN);
    if (!match) {
      console.warn(`skipping non-migration file: ${entry}`);
      continue;
    }
    const version = match[1];
    if (applied.has(version)) continue;

    if (dryRun) {
      console.log(`would apply ${entry}`);
      ran += 1;
      continue;
    }

    const sql = await readFile(path.join(MIGRATIONS_DIR, entry), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        `insert into neon_migrations.schema_migrations (version) values ($1)`,
        [version]
      );
      await client.query("commit");
      console.log(`applied ${entry}`);
      ran += 1;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      console.error(
        `failed applying ${entry}: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    } finally {
      client.release();
    }
  }

  console.log(
    ran === 0
      ? "no pending Neon migrations"
      : `${ran} migration(s) ${dryRun ? "pending" : "applied"}`
  );
  return true;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const connectionString =
    process.env.DATABASE_URL || process.env.mogplex_DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const ok = await applyPending(pool, dryRun);
    if (!ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// Top-level await is unavailable under the repo tsconfig's module setting.
// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
