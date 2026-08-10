-- Control sessions: durable chat history for the control surface. Each row
-- is one conversation (the full UIMessage array as jsonb, whole-array upsert
-- with optimistic concurrency on updated_at — the proven conversations-table
-- pattern), so the sidebar can list past and in-flight sessions and any
-- session can be restored client-side.
--
-- Loose coupling on purpose: no FKs to mirrored pre-cutover tables
-- (billing-foundation convention); user_id is a plain uuid.

create table if not exists public.control_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'New session',
  -- Full AI SDK UIMessage array; client-authoritative, replaced wholesale
  -- on each sync.
  messages jsonb not null default '[]'::jsonb,
  pinned boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sidebar list: a user's non-archived sessions, most recently active first.
create index control_sessions_user_updated_idx
  on public.control_sessions (user_id, updated_at desc)
  where archived = false;

alter table public.control_sessions enable row level security;

-- Access goes through the service role (supabaseAdmin / postgrest shim);
-- no direct client grants.
revoke all on public.control_sessions from public, anon, authenticated;
