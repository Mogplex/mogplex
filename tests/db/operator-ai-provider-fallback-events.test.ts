import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATIONS = [
  "supabase/migrations/20260819200000_operator_ai_provider_fallback_events.sql",
  "neon/migrations/20260819201000_operator_ai_provider_fallback_events.sql",
];
const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

async function createDatabase(migrationPath: string) {
  const database = new PGlite();
  databases.push(database);
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.profiles (id uuid primary key);
    create table public.repos (id uuid primary key);
    create table public.job_runs (id uuid primary key);
  `);
  const migration = await readFile(path.join(REPO_ROOT, migrationPath), "utf8");
  await database.exec(migration);
  return database;
}

for (const migrationPath of MIGRATIONS) {
  describe(migrationPath, () => {
    it("creates an append-only service-role table with RLS and no user access", async () => {
      const database = await createDatabase(migrationPath);
      const { rows } = await database.query<{
        rls_enabled: boolean;
        anon_select: boolean;
        authenticated_select: boolean;
        service_select: boolean;
        service_insert: boolean;
        service_update: boolean;
        service_delete: boolean;
      }>(`
        select
          class.relrowsecurity as rls_enabled,
          has_table_privilege(
            'anon', 'public.operator_ai_provider_fallback_events', 'select'
          ) as anon_select,
          has_table_privilege(
            'authenticated',
            'public.operator_ai_provider_fallback_events',
            'select'
          ) as authenticated_select,
          has_table_privilege(
            'service_role',
            'public.operator_ai_provider_fallback_events',
            'select'
          ) as service_select,
          has_table_privilege(
            'service_role',
            'public.operator_ai_provider_fallback_events',
            'insert'
          ) as service_insert,
          has_table_privilege(
            'service_role',
            'public.operator_ai_provider_fallback_events',
            'update'
          ) as service_update,
          has_table_privilege(
            'service_role',
            'public.operator_ai_provider_fallback_events',
            'delete'
          ) as service_delete
        from pg_catalog.pg_class class
        where class.oid =
          'public.operator_ai_provider_fallback_events'::regclass
      `);

      expect(rows).toEqual([
        {
          rls_enabled: true,
          anon_select: false,
          authenticated_select: false,
          service_select: true,
          service_insert: true,
          service_update: false,
          service_delete: false,
        },
      ]);
    });

    it("deduplicates durable events for the same model call", async () => {
      const database = await createDatabase(migrationPath);
      const userId = "00000000-0000-4000-8000-000000000001";
      const jobRunId = "00000000-0000-4000-8000-000000000002";
      const repoId = "00000000-0000-4000-8000-000000000003";
      await database.query(`insert into public.profiles (id) values ($1)`, [
        userId,
      ]);
      await database.query(`insert into public.job_runs (id) values ($1)`, [
        jobRunId,
      ]);
      await database.query(`insert into public.repos (id) values ($1)`, [
        repoId,
      ]);

      const insertSql = `
        insert into public.operator_ai_provider_fallback_events (
          affected_user_id,
          job_run_id,
          repo_id,
          model_call_started_at,
          phase,
          served_provider,
          fallback_providers,
          blackbox_failure_count,
          gateway_model_attempt_count
        ) values ($1, $2, $3, $4, 'pr_review', 'nebius', array['nebius'], 1, 1)
        on conflict (job_run_id, phase, model_call_started_at) do nothing
      `;
      const values = [userId, jobRunId, repoId, "2026-08-19T18:00:00.000Z"];
      await database.query(insertSql, values);
      await database.query(insertSql, values);

      const count = await database.query<{ count: number }>(
        `select count(*)::integer as count
         from public.operator_ai_provider_fallback_events`
      );
      expect(count.rows).toEqual([{ count: 1 }]);
    });
  });
}
