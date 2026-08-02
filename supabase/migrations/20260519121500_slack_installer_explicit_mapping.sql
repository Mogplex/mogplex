-- Slack installers have already proven both sides of the identity link:
-- Mogplex signed state binds the browser session to a profile, and Slack OAuth
-- returns the installing Slack user id. Persist that as an explicit mapping so
-- the installer can use Slack immediately after connecting the app.

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

  if nullif(trim(p_authed_user_slack_id), '') is not null then
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
      v_row.id,
      trim(p_authed_user_slack_id),
      p_installed_by_user_id,
      null,
      now(),
      'explicit',
      now(),
      p_installed_by_user_id
    )
    on conflict (slack_installation_id, slack_user_id) do update set
      mogplex_user_id = excluded.mogplex_user_id,
      matched_at = excluded.matched_at,
      link_status = 'explicit',
      linked_at = excluded.linked_at,
      linked_by_user_id = excluded.linked_by_user_id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.upsert_slack_installation(text, text, uuid, text, text, text[], text) from public;
grant execute on function public.upsert_slack_installation(text, text, uuid, text, text, text[], text) to service_role;

insert into public.slack_user_mappings as mapping (
  slack_installation_id,
  slack_user_id,
  mogplex_user_id,
  slack_email,
  matched_at,
  link_status,
  linked_at,
  linked_by_user_id
)
select
  si.id,
  trim(si.authed_user_slack_id),
  si.installed_by_user_id,
  null,
  now(),
  'explicit',
  now(),
  si.installed_by_user_id
from public.slack_installations si
where nullif(trim(si.authed_user_slack_id), '') is not null
on conflict (slack_installation_id, slack_user_id) do update set
  mogplex_user_id = excluded.mogplex_user_id,
  matched_at = excluded.matched_at,
  link_status = 'explicit',
  linked_at = excluded.linked_at,
  linked_by_user_id = excluded.linked_by_user_id;
