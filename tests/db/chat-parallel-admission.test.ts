import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATION =
  "supabase/migrations/20260814193000_parallel_chat_admission.sql";
const USER_ID = "00000000-0000-4000-8000-000000000216";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.ai_calls (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      type text not null,
      status text not null,
      started_at timestamptz not null default now(),
      limit_claim_id uuid
    );
    create table public.limit_events (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      route_key text not null,
      claim_id uuid,
      resource_id text,
      repo_id uuid,
      sandbox_id uuid,
      decision text not null,
      reason text,
      limit_name text,
      window_seconds int,
      limit_value int,
      remaining int,
      retry_after_seconds int,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  `);
  const sql = await readFile(path.join(REPO_ROOT, MIGRATION), "utf8");
  await db.exec(sql);
});

afterAll(async () => {
  await db.close();
});

describe("parallel chat admission", () => {
  it("keeps the SECURITY DEFINER admission RPC service-role only", async () => {
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
        and p.proname = 'claim_chat_limit_admission'
    `);

    expect(rows[0]).toEqual({
      anon_can_execute: false,
      authenticated_can_execute: false,
      service_role_can_execute: true,
    });
  });

  it("admits another chat when multiple chats are already streaming", async () => {
    await db.query(
      `insert into public.ai_calls (user_id, type, status)
       values ($1, 'chat', 'streaming'), ($1, 'chat', 'streaming'),
              ($1, 'chat', 'streaming')`,
      [USER_ID]
    );

    const { rows } = await db.query<{
      allowed: boolean;
      claim_id: string | null;
      reason: string | null;
    }>(
      `select allowed, claim_id, reason
       from public.claim_chat_limit_admission(
         p_user_id => $1,
         p_now => '2026-08-14T19:30:00.000Z'::timestamptz,
         p_concurrent_limit => 2
       )`,
      [USER_ID]
    );

    expect(rows[0]).toMatchObject({
      allowed: true,
      reason: null,
    });
    expect(rows[0]?.claim_id).toBeTruthy();
  });
});
