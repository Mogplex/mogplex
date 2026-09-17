import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { checkSchemaCompatibility } from "../support/schema-compatibility-contract";

let db: PGlite;
const queryable = {
  query: async (sql: string, values?: unknown[]) => ({
    rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
  }),
};
beforeEach(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    parsers: SHIM_TYPE_PARSERS,
  });
  const applied = await applyNeonMigrations(db, {
    log: () => {},
    warn: () => {},
  });
  expect(applied.ok).toBe(true);
  await checkSchemaCompatibility(queryable, "seed");
});
afterEach(async () => {
  await db?.close();
});

describe("previous-release database contracts", () => {
  it("preserves existing data and old reads, writes, and worker RPCs after an additive migration", async () => {
    await db.exec(
      "alter table public.workspaces add column compatibility_note text"
    );
    await expect(
      checkSchemaCompatibility(queryable, "verify")
    ).resolves.toBeUndefined();
  });
  it("rejects a removed column still read by the application", async () => {
    await db.exec(
      "alter table public.control_sessions drop column orchestration_run_id"
    );
    await expect(checkSchemaCompatibility(queryable, "verify")).rejects.toThrow(
      /control_sessions_select/
    );
  });
  it("rejects a removed worker RPC", async () => {
    const signatures = await db.query<{ args: string }>(
      "select pg_get_function_identity_arguments(oid) as args from pg_proc where proname='record_job_run_start_attempt'"
    );
    expect(signatures.rows.length).toBeGreaterThan(0);
    for (const row of signatures.rows)
      await db.exec(
        `drop function public.record_job_run_start_attempt(${row.args})`
      );
    await expect(checkSchemaCompatibility(queryable, "verify")).rejects.toThrow(
      /Failed to record job start attempt/
    );
  });
  it("rejects migrations that change already-persisted values", async () => {
    await db.exec("update public.job_runs set metadata='{}'::jsonb");
    await expect(
      checkSchemaCompatibility(queryable, "verify")
    ).rejects.toThrow();
  });
  it("rejects migrations that overwrite an existing Control conversation", async () => {
    await db.exec("update public.control_sessions set title='Overwritten'");
    await expect(
      checkSchemaCompatibility(queryable, "verify")
    ).rejects.toThrow();
  });
});
