-- Harden Slack account linking and workspace ownership semantics.
--
-- Slack email matching is useful as a hint, but it should not authorize
-- privileged actions. Explicit link tokens below make the Slack user ->
-- Mogplex profile relationship deliberate and auditable.

alter table public.slack_user_mappings
  add column if not exists link_status text not null default 'legacy_email',
  add column if not exists linked_at timestamptz,
  add column if not exists linked_by_user_id uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'slack_user_mappings_link_status_check'
      and conrelid = 'public.slack_user_mappings'::regclass
  ) then
    alter table public.slack_user_mappings
      add constraint slack_user_mappings_link_status_check
      check (link_status in ('legacy_email', 'explicit'));
  end if;
end $$;

create index if not exists slack_user_mappings_explicit_idx
  on public.slack_user_mappings (slack_installation_id, slack_user_id)
  where link_status = 'explicit' and mogplex_user_id is not null;

create table if not exists public.slack_user_link_tokens (
  id uuid primary key default gen_random_uuid(),
  slack_installation_id uuid not null references public.slack_installations(id) on delete cascade,
  team_id text not null,
  slack_user_id text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists slack_user_link_tokens_lookup_idx
  on public.slack_user_link_tokens (token_hash)
  where consumed_at is null;

create index if not exists slack_user_link_tokens_user_idx
  on public.slack_user_link_tokens (
    slack_installation_id,
    slack_user_id,
    expires_at desc
  );

alter table public.slack_user_link_tokens enable row level security;
-- Service-role only. Link tokens are bearer credentials and must not be exposed
-- through end-user JWT access.

grant select, insert, update on public.slack_user_link_tokens to service_role;

comment on column public.slack_installations.allowed_slack_user_ids is
  'Optional Slack user id allowlist for starting repo-agent runs. Null means any explicitly mapped Mogplex user may start runs; an empty array allows nobody.';

create or replace function public.consume_slack_user_link_token(
  p_token_hash text,
  p_mogplex_user_id uuid
) returns public.slack_user_mappings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.slack_user_link_tokens;
  v_mapping public.slack_user_mappings;
begin
  if nullif(trim(p_token_hash), '') is null then
    raise exception 'token hash is required';
  end if;
  if p_mogplex_user_id is null then
    raise exception 'mogplex user id is required';
  end if;

  select *
    into v_token
  from public.slack_user_link_tokens
  where token_hash = p_token_hash
    and consumed_at is null
    and expires_at > now()
  for update;

  if v_token.id is null then
    return null;
  end if;

  update public.slack_user_link_tokens
    set consumed_at = now()
  where id = v_token.id;

  insert into public.slack_user_mappings as mapping (
    slack_installation_id,
    slack_user_id,
    mogplex_user_id,
    slack_email,
    matched_at,
    link_status,
    linked_at,
    linked_by_user_id
  ) values (
    v_token.slack_installation_id,
    v_token.slack_user_id,
    p_mogplex_user_id,
    -- Link tokens do not carry Slack profile data. A fresh explicit link keeps
    -- this null until a later users.info refresh; relinks preserve existing
    -- slack_email because the conflict update intentionally omits it.
    null,
    now(),
    'explicit',
    now(),
    p_mogplex_user_id
  )
  on conflict (slack_installation_id, slack_user_id) do update set
    mogplex_user_id = excluded.mogplex_user_id,
    matched_at = excluded.matched_at,
    link_status = 'explicit',
    linked_at = excluded.linked_at,
    linked_by_user_id = excluded.linked_by_user_id
  returning mapping.* into v_mapping;

  return v_mapping;
end;
$$;

revoke all on function public.consume_slack_user_link_token(text, uuid) from public;
grant execute on function public.consume_slack_user_link_token(text, uuid) to service_role;

create or replace function public.upsert_slack_installation(
  p_team_id text,
  p_team_name text,
  p_installed_by_user_id uuid,
  p_bot_user_id text,
  p_bot_token text,
  p_scopes text[],
  p_authed_user_slack_id text
) returns public.slack_installations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_secret_id uuid;
  v_existing_installed_by_user_id uuid;
  v_new_secret_id uuid;
  v_row public.slack_installations;
begin
  perform pg_advisory_xact_lock(hashtextextended('slack_install', hashtext(p_team_id)));

  select vault_bot_token_id, installed_by_user_id
    into v_existing_secret_id, v_existing_installed_by_user_id
  from public.slack_installations
  where team_id = p_team_id;

  if v_existing_secret_id is not null then
    delete from vault.secrets where id = v_existing_secret_id;
  end if;

  select vault.create_secret(
    p_bot_token,
    'slack/' || p_team_id || '/bot_token',
    'Slack bot token for workspace ' || p_team_id
  ) into v_new_secret_id;

  if v_new_secret_id is null then
    raise exception 'vault.create_secret returned null for team %', p_team_id;
  end if;

  insert into public.slack_installations as si (
    team_id,
    team_name,
    installed_by_user_id,
    bot_user_id,
    vault_bot_token_id,
    scopes,
    authed_user_slack_id,
    updated_at
  ) values (
    p_team_id,
    p_team_name,
    p_installed_by_user_id,
    p_bot_user_id,
    v_new_secret_id,
    coalesce(p_scopes, array[]::text[]),
    p_authed_user_slack_id,
    now()
  )
  on conflict (team_id) do update set
    team_name = excluded.team_name,
    installed_by_user_id = excluded.installed_by_user_id,
    bot_user_id = excluded.bot_user_id,
    vault_bot_token_id = excluded.vault_bot_token_id,
    scopes = excluded.scopes,
    authed_user_slack_id = excluded.authed_user_slack_id,
    updated_at = excluded.updated_at
  returning si.* into v_row;

  if v_existing_installed_by_user_id is not null
    and v_existing_installed_by_user_id <> p_installed_by_user_id then
    delete from public.slack_channel_links
    where slack_installation_id = v_row.id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.upsert_slack_installation(text, text, uuid, text, text, text[], text) from public;
grant execute on function public.upsert_slack_installation(text, text, uuid, text, text, text[], text) to service_role;
