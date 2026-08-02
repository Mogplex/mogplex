-- Close race conditions in the Slack install/uninstall RPCs (follow-up to #385).
--
-- The functions added in 20260511130000_slack_installation_atomic_writes.sql
-- still had two windows where a Vault secret could be orphaned under concurrent
-- load:
--   1. upsert_slack_installation read the existing secret id without any lock,
--      so two concurrent installs for the same team could both read the same
--      old secret, both create a new one, and the upsert loser's secret would
--      be orphaned. The initial-insert path has no row to lock at all.
--   2. delete_slack_installation read the row/secret id in one statement and
--      deleted by id in a later one; a concurrent reinstall could swap the
--      secret in between, leaving the freshly-created secret orphaned.
--
-- Fixes: take a transaction-scoped advisory lock keyed on team_id at the top of
-- upsert_slack_installation, validate vault.create_secret's return value, and
-- use DELETE ... RETURNING in delete_slack_installation so the row is locked
-- and deleted atomically with the secret id we act on.

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
  v_new_secret_id uuid;
  v_row public.slack_installations;
begin
  -- Serialize concurrent install/uninstall for the same workspace so the
  -- read-old-secret / create-new-secret / upsert-row sequence is atomic.
  perform pg_advisory_xact_lock(hashtextextended('slack_install', hashtext(p_team_id)));

  select vault_bot_token_id into v_existing_secret_id
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

  return v_row;
end;
$$;

create or replace function public.delete_slack_installation(
  p_team_id text,
  p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_secret_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('slack_install', hashtext(p_team_id)));

  -- DELETE ... RETURNING locks and removes the row in one statement, so the
  -- secret id we read is the one actually attached to the row we deleted.
  delete from public.slack_installations
  where team_id = p_team_id and installed_by_user_id = p_user_id
  returning id, vault_bot_token_id into v_id, v_secret_id;

  if v_id is null then
    return false;
  end if;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;

  return true;
end;
$$;

revoke all on function public.upsert_slack_installation(text, text, uuid, text, text, text[], text) from public;
revoke all on function public.delete_slack_installation(text, uuid) from public;
