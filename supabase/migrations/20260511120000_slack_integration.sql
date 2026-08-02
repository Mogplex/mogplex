-- Slack integration: workspace-level installs, channel→repo routing, thread
-- continuity, and lazy slack-user → mogplex-profile mapping. Bot tokens live in
-- Supabase Vault; the workspace table only stores the secret id.

------------------------------------------------------------------------------
-- 1. slack_installations  (workspace-level OAuth installation)
------------------------------------------------------------------------------

create table if not exists public.slack_installations (
  id uuid primary key default gen_random_uuid(),
  team_id text not null unique,
  team_name text,
  installed_by_user_id uuid not null references public.profiles(id) on delete cascade,
  bot_user_id text not null,
  vault_bot_token_id uuid not null,
  scopes text[] not null default array[]::text[],
  authed_user_slack_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists slack_installations_installer_idx
  on public.slack_installations (installed_by_user_id);

alter table public.slack_installations enable row level security;

drop policy if exists "owner_select" on public.slack_installations;
create policy "owner_select" on public.slack_installations
  for select using (installed_by_user_id = public.current_profile_id());

------------------------------------------------------------------------------
-- 2. slack_channel_links  (one channel ↔ one Mogplex repo)
------------------------------------------------------------------------------

create table if not exists public.slack_channel_links (
  id uuid primary key default gen_random_uuid(),
  slack_installation_id uuid not null references public.slack_installations(id) on delete cascade,
  channel_id text not null,
  channel_name text,
  repo_id uuid not null references public.repos(id) on delete cascade,
  created_by_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint slack_channel_links_unique unique (slack_installation_id, channel_id)
);

create index if not exists slack_channel_links_repo_idx
  on public.slack_channel_links (repo_id);

alter table public.slack_channel_links enable row level security;

drop policy if exists "owner_select" on public.slack_channel_links;
create policy "owner_select" on public.slack_channel_links
  for select using (created_by_user_id = public.current_profile_id());

------------------------------------------------------------------------------
-- 3. slack_thread_conversations  (Slack thread → Mogplex conversation)
------------------------------------------------------------------------------

create table if not exists public.slack_thread_conversations (
  id uuid primary key default gen_random_uuid(),
  slack_installation_id uuid not null references public.slack_installations(id) on delete cascade,
  channel_id text not null,
  thread_ts text not null,
  conversation_id text not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint slack_thread_conversations_unique
    unique (slack_installation_id, channel_id, thread_ts)
);

create index if not exists slack_thread_conversations_conversation_idx
  on public.slack_thread_conversations (conversation_id);

alter table public.slack_thread_conversations enable row level security;
-- No end-user select policy: this table is service-role-only. Conversations
-- themselves are exposed through the existing conversations API.

------------------------------------------------------------------------------
-- 4. slack_user_mappings  (lazy slack-user → mogplex-profile match)
------------------------------------------------------------------------------

create table if not exists public.slack_user_mappings (
  id uuid primary key default gen_random_uuid(),
  slack_installation_id uuid not null references public.slack_installations(id) on delete cascade,
  slack_user_id text not null,
  mogplex_user_id uuid references public.profiles(id) on delete set null,
  slack_email text,
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  constraint slack_user_mappings_unique unique (slack_installation_id, slack_user_id)
);

create index if not exists slack_user_mappings_mogplex_idx
  on public.slack_user_mappings (mogplex_user_id)
  where mogplex_user_id is not null;

alter table public.slack_user_mappings enable row level security;
-- Service-role only; not exposed via end-user JWT.

------------------------------------------------------------------------------
-- 5. Vault helpers — mirror store_oauth_token / get_oauth_token but keyed on
--    workspace (team_id) rather than user.
------------------------------------------------------------------------------

create or replace function public.store_slack_bot_token(
  p_team_id text,
  p_token text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_secret_id uuid;
  v_new_secret_id uuid;
begin
  select vault_bot_token_id into v_existing_secret_id
  from public.slack_installations
  where team_id = p_team_id;

  if v_existing_secret_id is not null then
    delete from vault.secrets where id = v_existing_secret_id;
  end if;

  select vault.create_secret(
    p_token,
    'slack/' || p_team_id || '/bot_token',
    'Slack bot token for workspace ' || p_team_id
  ) into v_new_secret_id;

  return v_new_secret_id;
end;
$$;

create or replace function public.get_slack_bot_token(
  p_team_id text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
  v_token text;
begin
  select vault_bot_token_id into v_secret_id
  from public.slack_installations
  where team_id = p_team_id;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where id = v_secret_id;

  return v_token;
end;
$$;

create or replace function public.delete_slack_bot_token(
  p_team_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
begin
  select vault_bot_token_id into v_secret_id
  from public.slack_installations
  where team_id = p_team_id;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

revoke all on function public.store_slack_bot_token(text, text) from public;
revoke all on function public.get_slack_bot_token(text) from public;
revoke all on function public.delete_slack_bot_token(text) from public;
