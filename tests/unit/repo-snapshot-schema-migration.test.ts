import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDir = new URL("../../supabase/migrations/", import.meta.url);

async function readAllMigrationSql() {
  const entries = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const contents = await Promise.all(
    entries.map((name) => readFile(new URL(name, migrationsDir), "utf8"))
  );

  return contents.join("\n\n");
}

test("supabase migrations define repo snapshot metadata columns", async () => {
  const sql = await readAllMigrationSql();

  assert.match(
    sql,
    /alter table\s+public\.repos[\s\S]*add column if not exists snapshot_id\s+text/i
  );
  assert.match(
    sql,
    /alter table\s+public\.repos[\s\S]*add column if not exists snapshot_lockfile_hash\s+text/i
  );
  assert.match(
    sql,
    /alter table\s+public\.repos[\s\S]*add column if not exists snapshot_created_at\s+timestamptz/i
  );
  assert.match(
    sql,
    /alter table\s+public\.repos[\s\S]*add column if not exists snapshot_commit_sha\s+text/i
  );
  assert.match(sql, /create index if not exists idx_repos_snapshot_id/i);
});
