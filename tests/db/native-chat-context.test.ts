import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATION_NAME = "20260830150000_native_chat_context.sql";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const REPO_ID = "00000000-0000-4000-8000-000000000002";
const SANDBOX_ID = "00000000-0000-4000-8000-000000000004";

async function createSeededDb() {
  const db = new PGlite();
  await db.exec(`
    create table public.repos (id uuid primary key);
    create table public.sandboxes (
      id uuid primary key,
      user_id uuid not null,
      repo_id uuid references public.repos(id) on delete cascade
    );
    create table public.conversations (
      id text primary key,
      user_id uuid not null,
      updated_at timestamptz default now()
    );
    create table public.ai_calls (
      id uuid primary key,
      user_id uuid not null,
      conversation_id text,
      repo_id uuid references public.repos(id) on delete set null,
      metadata jsonb default '{}'::jsonb,
      started_at timestamptz default now()
    );

    insert into public.repos (id) values ('${REPO_ID}');
    insert into public.sandboxes (id, user_id, repo_id)
      values ('${SANDBOX_ID}', '${USER_ID}', '${REPO_ID}');
    insert into public.conversations (id, user_id)
      values ('conversation-1', '${USER_ID}');
    insert into public.ai_calls (
      id, user_id, conversation_id, repo_id, metadata, started_at
    ) values (
      '00000000-0000-4000-8000-000000000003',
      '${USER_ID}',
      'conversation-1',
      '${REPO_ID}',
      '{"sandbox_id":"${SANDBOX_ID}"}'::jsonb,
      '2026-08-30T12:00:00Z'
    );
  `);
  return db;
}

async function verifyMigration(migrationPath: string) {
  const db = await createSeededDb();
  try {
    const sql = await readFile(path.join(REPO_ROOT, migrationPath), "utf8");
    await db.exec(sql);
    await db.exec(sql);

    const { rows } = await db.query<{
      repo_id: string | null;
      workspace_session_id: string | null;
      sandbox_id: string | null;
    }>(`
      select repo_id, workspace_session_id, sandbox_id
      from public.conversations
      where id = 'conversation-1'
    `);
    expect(rows[0]).toEqual({
      repo_id: REPO_ID,
      workspace_session_id: null,
      sandbox_id: SANDBOX_ID,
    });

    await db.exec(`delete from public.repos where id = '${REPO_ID}'`);
    const afterDelete = await db.query<{ repo_id: string | null }>(`
      select repo_id from public.conversations where id = 'conversation-1'
    `);
    expect(afterDelete.rows[0]?.repo_id).toBeNull();
  } finally {
    await db.close();
  }
}

describe("native chat context migration", () => {
  it("keeps the production migration ledgers identical", async () => {
    const [neon, supabase] = await Promise.all([
      readFile(path.join(REPO_ROOT, "neon/migrations", MIGRATION_NAME), "utf8"),
      readFile(
        path.join(REPO_ROOT, "supabase/migrations", MIGRATION_NAME),
        "utf8"
      ),
    ]);
    expect(neon).toBe(supabase);
  });

  it("backfills and constrains Supabase conversation context", async () => {
    await verifyMigration(`supabase/migrations/${MIGRATION_NAME}`);
  });

  it("backfills and constrains Neon conversation context", async () => {
    await verifyMigration(`neon/migrations/${MIGRATION_NAME}`);
  });
});
