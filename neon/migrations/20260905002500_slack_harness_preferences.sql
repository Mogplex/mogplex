-- Each Slack user selects a runner independently within a channel.
create table if not exists public.slack_harness_preferences (
  id uuid primary key default gen_random_uuid(),
  slack_installation_id uuid not null
    references public.slack_installations(id) on delete cascade,
  channel_id text not null check (length(btrim(channel_id)) > 0),
  slack_user_id text not null check (length(btrim(slack_user_id)) > 0),
  harness text not null check (harness in ('mogplex', 'codex', 'claude-code')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slack_installation_id, channel_id, slack_user_id)
);
alter table public.slack_harness_preferences enable row level security;
-- The signed webhook resolves and authorizes the actor before any access.
revoke all on table public.slack_harness_preferences from anon, authenticated;
grant select, insert, update on table public.slack_harness_preferences to service_role;
