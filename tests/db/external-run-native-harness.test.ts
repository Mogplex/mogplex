import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

for (const directory of ["neon", "supabase"]) {
  it(`${directory}: allows Mogplex while preserving existing runs and rejecting unknown harnesses`, async () => {
    const db = new PGlite();
    try {
      await db.exec(`create table public.external_agent_runs (
        id integer primary key, harness text not null check (harness in ('codex', 'claude-code'))
      ); insert into public.external_agent_runs values (1, 'claude-code');`);
      await expect(
        db.exec("insert into public.external_agent_runs values (2, 'mogplex')")
      ).rejects.toThrow();
      const migration = await readFile(
        new URL(
          `../../${directory}/migrations/20260904235500_external_agent_run_mogplex_harness.sql`,
          import.meta.url
        ),
        "utf8"
      );
      await db.exec(migration);
      await db.exec(migration);
      await db.exec(
        "insert into public.external_agent_runs values (2, 'mogplex'), (3, 'codex')"
      );
      expect(
        (
          await db.query(
            "select harness from public.external_agent_runs order by id"
          )
        ).rows
      ).toEqual([
        { harness: "claude-code" },
        { harness: "mogplex" },
        { harness: "codex" },
      ]);
      await expect(
        db.exec("insert into public.external_agent_runs values (4, 'other')")
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
}
