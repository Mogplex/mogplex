-- Team owner transfer helper.
-- Keeps teams.owner_user_id and team_members roles consistent in one
-- transaction. The API still performs app-level authorization before calling.

drop function if exists public.transfer_team_ownership(uuid, uuid, uuid) cascade;

create function public.transfer_team_ownership(
  p_team_id uuid,
  p_current_owner_user_id uuid,
  p_next_owner_user_id uuid
) returns table (
  previous_owner_user_id uuid,
  next_owner_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_owner_user_id uuid;
  v_current_owner_role text;
  v_next_owner_role text;
begin
  if p_current_owner_user_id = p_next_owner_user_id then
    raise exception 'cannot transfer ownership to the current owner'
      using errcode = 'check_violation';
  end if;

  select owner_user_id
    into v_team_owner_user_id
  from public.teams
  where id = p_team_id
  for update;

  if v_team_owner_user_id is null then
    raise exception 'team not found'
      using errcode = 'no_data_found';
  end if;

  if v_team_owner_user_id <> p_current_owner_user_id then
    raise exception 'only the current owner can transfer team ownership'
      using errcode = 'insufficient_privilege';
  end if;

  select role
    into v_current_owner_role
  from public.team_members
  where team_id = p_team_id
    and user_id = p_current_owner_user_id
  for update;

  if v_current_owner_role is null or v_current_owner_role <> 'owner' then
    raise exception 'current owner membership not found'
      using errcode = 'raise_exception';
  end if;

  select role
    into v_next_owner_role
  from public.team_members
  where team_id = p_team_id
    and user_id = p_next_owner_user_id
  for update;

  if v_next_owner_role is null then
    raise exception 'next owner is not a team member'
      using errcode = 'no_data_found';
  end if;

  if v_next_owner_role <> 'admin' then
    raise exception 'ownership can only transfer to an admin'
      using errcode = 'check_violation';
  end if;

  update public.team_members
  set role = 'owner'
  where team_id = p_team_id
    and user_id = p_next_owner_user_id;

  update public.team_members
  set role = 'admin'
  where team_id = p_team_id
    and user_id = p_current_owner_user_id;

  update public.teams
  set owner_user_id = p_next_owner_user_id,
      updated_at = now()
  where id = p_team_id;

  previous_owner_user_id := p_current_owner_user_id;
  next_owner_user_id := p_next_owner_user_id;
  return next;
end;
$$;

revoke all on function public.transfer_team_ownership(uuid, uuid, uuid) from public;
grant execute on function public.transfer_team_ownership(uuid, uuid, uuid) to service_role;
