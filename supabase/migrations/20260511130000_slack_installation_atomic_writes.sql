-- Make Slack install/uninstall writes atomic.
--
-- Previously the API mutated the Vault secret and the slack_installations row
-- in two separate round-trips, so a failure between them could leave an
-- orphaned secret (row write failed after secret stored) or a dangling
-- vault_bot_token_id (row deleted but secret delete failed). Fold both steps
-- into single SECURITY DEFINER functions that run in one transaction.
-- See GitHub issue #385.

------------------------------------------------------------------------------
-- upsert_slack_installation: store the bot token in Vault and upsert the
-- workspace row pointing at it, atomically. Returns the resulting row.
------------------------------------------------------------------------------

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

------------------------------------------------------------------------------
-- delete_slack_installation: remove the workspace row (scoped to the
-- installer) and its Vault secret, atomically. Returns true if a row was
-- deleted, false if there was nothing to delete.
------------------------------------------------------------------------------

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
  select id, vault_bot_token_id into v_id, v_secret_id
  from public.slack_installations
  where team_id = p_team_id and installed_by_user_id = p_user_id;

  if v_id is null then
    return false;
  end if;

  delete from public.slack_installations where id = v_id;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;

  return true;
end;
$$;

revoke all on function public.upsert_slack_installation(text, text, uuid, text, text, text[], text) from public;
revoke all on function public.delete_slack_installation(text, uuid) from public;
