import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";

for (const backend of ["neon", "supabase"]) {
  test(`${backend} harness preferences enforce private scoped selections`, async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon; create role authenticated; create role service_role;
        create table public.slack_installations (id uuid primary key);
        insert into public.slack_installations values
          ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
      `);
      const migration = await readFile(
        path.resolve(
          import.meta.dirname,
          "../..",
          backend,
          "migrations/20260905002500_slack_harness_preferences.sql"
        ),
        "utf8"
      );
      await db.exec(migration);
      await db.exec(migration);
      const insert = (
        installation: number,
        channel: string,
        user: string,
        harness: string
      ) =>
        db.query(
          "insert into public.slack_harness_preferences (slack_installation_id, channel_id, slack_user_id, harness) values ($1, $2, $3, $4)",
          [
            `00000000-0000-4000-8000-00000000000${installation}`,
            channel,
            user,
            harness,
          ]
        );
      await insert(1, "C1", "U1", "mogplex");
      await insert(1, "C1", "U2", "codex");
      await insert(1, "C2", "U1", "claude-code");
      await insert(2, "C1", "U1", "codex");
      await expect(insert(1, "C1", "U1", "codex")).rejects.toThrow(
        /unique|duplicate/i
      );
      await expect(insert(1, "C1", "U3", "unknown")).rejects.toThrow(/check/i);
      await expect(insert(1, " ", "U3", "mogplex")).rejects.toThrow(/check/i);
      const { rows } = await db.query(`select relrowsecurity as rls,
        has_table_privilege('anon', 'public.slack_harness_preferences', 'select') as anon_read,
        has_table_privilege('authenticated', 'public.slack_harness_preferences', 'update') as auth_write,
        has_table_privilege('service_role', 'public.slack_harness_preferences', 'insert') as service_write
        from pg_class where oid = 'public.slack_harness_preferences'::regclass`);
      expect(rows[0]).toEqual({
        rls: true,
        anon_read: false,
        auth_write: false,
        service_write: true,
      });
      await db.exec(
        "delete from public.slack_installations where id = '00000000-0000-4000-8000-000000000001'"
      );
      const remaining = await db.query(
        "select harness from public.slack_harness_preferences"
      );
      expect(remaining.rows).toEqual([{ harness: "codex" }]);
    } finally {
      await db.close();
    }
  });
}
