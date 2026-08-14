import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATION =
  "supabase/migrations/20260814231500_observability_job_run_stats.sql";
const USER_ID = "00000000-0000-4000-8000-000000000173";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000999";
const LARGE_HISTORY_USER_ID = "00000000-0000-4000-8000-000000001005";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create table public.repos (
      id uuid primary key,
      user_id uuid not null
    );
    create table public.assignments (
      id uuid primary key,
      repo_id uuid not null references public.repos(id)
    );
    create table public.triggers (
      id uuid primary key,
      user_id uuid not null
    );
    create table public.flows (
      id uuid primary key,
      user_id uuid not null
    );
    create table public.job_runs (
      id uuid primary key,
      assignment_id uuid references public.assignments(id),
      trigger_id uuid references public.triggers(id),
      flow_id uuid references public.flows(id),
      status text not null,
      created_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      last_start_attempt_at timestamptz,
      last_start_source text
    );
  `);
  const sql = await readFile(path.join(REPO_ROOT, MIGRATION), "utf8");
  await db.exec(sql);
});

afterAll(async () => {
  await db.close();
});

describe("observability job-run stats", () => {
  it("keeps the aggregate RPC service-role only", async () => {
    const { rows } = await db.query<{
      anon_can_execute: boolean;
      authenticated_can_execute: boolean;
      service_role_can_execute: boolean;
    }>(`
      select
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'observability_job_run_stats'
    `);

    expect(rows[0]).toEqual({
      anon_can_execute: false,
      authenticated_can_execute: false,
      service_role_can_execute: true,
    });
  });

  it("aggregates all owned run paths once without transferring paginated rows", async () => {
    await db.exec(`
      insert into public.repos (id, user_id) values
        ('10000000-0000-4000-8000-000000000173', '${USER_ID}'),
        ('10000000-0000-4000-8000-000000000999', '${OTHER_USER_ID}');
      insert into public.assignments (id, repo_id) values
        ('20000000-0000-4000-8000-000000000173', '10000000-0000-4000-8000-000000000173'),
        ('20000000-0000-4000-8000-000000000999', '10000000-0000-4000-8000-000000000999');
      insert into public.triggers (id, user_id) values
        ('30000000-0000-4000-8000-000000000173', '${USER_ID}'),
        ('30000000-0000-4000-8000-000000000999', '${OTHER_USER_ID}');
      insert into public.flows (id, user_id) values
        ('40000000-0000-4000-8000-000000000173', '${USER_ID}'),
        ('40000000-0000-4000-8000-000000000999', '${OTHER_USER_ID}');

      insert into public.job_runs (
        id, assignment_id, trigger_id, flow_id, status, created_at,
        started_at, completed_at, last_start_attempt_at, last_start_source
      ) values
        -- Matches all three ownership paths and must still count only once.
        ('50000000-0000-4000-8000-000000000001',
         '20000000-0000-4000-8000-000000000173',
         '30000000-0000-4000-8000-000000000173',
         '40000000-0000-4000-8000-000000000173',
         'pending', '2026-08-14 09:00:00+00', null, null,
         '2026-08-14 09:00:00+00', null),
        ('50000000-0000-4000-8000-000000000002', null,
         '30000000-0000-4000-8000-000000000173', null,
         'pending', '2026-08-14 11:59:00+00', null, null, null, null),
        ('50000000-0000-4000-8000-000000000003', null, null,
         '40000000-0000-4000-8000-000000000173',
         'running', '2026-08-14 10:00:00+00', '2026-08-14 10:01:00+00',
         null, null, null),
        ('50000000-0000-4000-8000-000000000004',
         '20000000-0000-4000-8000-000000000173', null, null,
         'failed', '2026-08-14 10:20:00+00', '2026-08-14 10:30:00+00',
         '2026-08-14 11:00:00+00', null, null),
        ('50000000-0000-4000-8000-000000000005', null, null,
         '40000000-0000-4000-8000-000000000173',
         'success', '2026-08-14 09:00:00+00', '2026-08-14 09:15:00+00',
         '2026-08-14 11:15:00+00', null, null),
        ('50000000-0000-4000-8000-000000000006', null,
         '30000000-0000-4000-8000-000000000173', null,
         'success', '2026-08-14 10:00:00+00', '2026-08-14 10:05:00+00',
         '2026-08-14 12:00:00+00', '2026-08-14 10:15:00+00', 'repair'),
        ('50000000-0000-4000-8000-000000000007', null, null,
         '40000000-0000-4000-8000-000000000173',
         'cancelled', '2026-08-14 10:00:00+00', '2026-08-14 10:05:00+00',
         '2026-08-14 10:10:00+00', null, null),
        ('50000000-0000-4000-8000-000000000999',
         '20000000-0000-4000-8000-000000000999',
         '30000000-0000-4000-8000-000000000999',
         '40000000-0000-4000-8000-000000000999',
         'success', '2026-08-14 10:00:00+00', '2026-08-14 10:05:00+00',
         '2026-08-14 10:10:00+00', null, null);
    `);

    const { rows } = await db.query<{ stats: Record<string, number> }>(
      `select public.observability_job_run_stats(
         p_user_id => $1,
         p_window_start => '2026-08-14 10:00:00+00',
         p_window_end => '2026-08-14 12:00:00+00',
         p_now => '2026-08-14 12:00:00+00',
         p_repairable_before => '2026-08-14 11:58:00+00'
       ) as stats`,
      [USER_ID]
    );

    expect(rows[0]?.stats).toEqual({
      total: 7,
      running: 1,
      pending: 2,
      repairable_pending: 1,
      failed_in_range: 1,
      repaired_in_range: 1,
      concluded_in_range: 3,
      successful_in_range: 2,
      oldest_pending_age_ms: 10_800_000,
    });
  });

  it("counts histories larger than one PostgREST page without truncation", async () => {
    await db.exec(`
      insert into public.repos (id, user_id)
      values ('10000000-0000-4000-8000-000000001005', '${LARGE_HISTORY_USER_ID}');
      insert into public.assignments (id, repo_id)
      values (
        '20000000-0000-4000-8000-000000001005',
        '10000000-0000-4000-8000-000000001005'
      );
      insert into public.job_runs (
        id, assignment_id, status, created_at, started_at, completed_at
      )
      select
        ('60000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
        '20000000-0000-4000-8000-000000001005'::uuid,
        'success',
        '2026-08-14 10:00:00+00'::timestamptz,
        '2026-08-14 10:01:00+00'::timestamptz,
        '2026-08-14 10:02:00+00'::timestamptz
      from generate_series(1, 1005) as runs(n);
    `);

    const { rows } = await db.query<{ stats: Record<string, number> }>(
      `select public.observability_job_run_stats(
         p_user_id => $1,
         p_window_start => '2026-08-14 10:00:00+00',
         p_window_end => '2026-08-14 12:00:00+00',
         p_now => '2026-08-14 12:00:00+00',
         p_repairable_before => '2026-08-14 11:58:00+00'
       ) as stats`,
      [LARGE_HISTORY_USER_ID]
    );

    expect(rows[0]?.stats).toMatchObject({
      total: 1005,
      concluded_in_range: 1005,
      successful_in_range: 1005,
    });
  });
});
