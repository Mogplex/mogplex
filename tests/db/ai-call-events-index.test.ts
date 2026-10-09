import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ai_call_events activity index migration", () => {
  it("creates the idx_ai_call_events_ai_call_created index", async () => {
    const pg = await PGlite.create();
    try {
      // Create the table that the index targets
      await pg.exec(`
        create table public.ai_call_events (
          id uuid primary key default gen_random_uuid(),
          ai_call_id text not null,
          created_at timestamptz not null default now()
        );
      `);

      // Apply the migration
      const migrationPath = join(
        process.cwd(),
        "neon/migrations/20261008120000_ai_call_events_activity_index.sql"
      );
      const migration = readFileSync(migrationPath, "utf-8");
      await pg.exec(migration);

      // Verify the index exists
      const { rows } = await pg.query<{
        indexname: string;
        indexdef: string;
      }>(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'ai_call_events'
          AND indexname = 'idx_ai_call_events_ai_call_created'
      `);

      expect(rows).toHaveLength(1);
      expect(rows[0].indexname).toBe("idx_ai_call_events_ai_call_created");
      expect(rows[0].indexdef).toContain("ai_call_id");
      expect(rows[0].indexdef).toContain("created_at");
    } finally {
      await pg.close();
    }
  });

  it("is idempotent (CREATE INDEX IF NOT EXISTS)", async () => {
    const pg = await PGlite.create();
    try {
      await pg.exec(`
        create table public.ai_call_events (
          id uuid primary key default gen_random_uuid(),
          ai_call_id text not null,
          created_at timestamptz not null default now()
        );
      `);

      const migrationPath = join(
        process.cwd(),
        "neon/migrations/20261008120000_ai_call_events_activity_index.sql"
      );
      const migration = readFileSync(migrationPath, "utf-8");

      // Apply twice - should not throw
      await pg.exec(migration);
      await pg.exec(migration);

      const { rows } = await pg.query<{ count: string }>(`
        SELECT count(*) as count
        FROM pg_indexes
        WHERE tablename = 'ai_call_events'
          AND indexname = 'idx_ai_call_events_ai_call_created'
      `);

      expect(Number(rows[0].count)).toBe(1);
    } finally {
      await pg.close();
    }
  });
});
