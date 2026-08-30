drop function if exists public.accept_team_invite(text, uuid, boolean);

create function public.accept_team_invite(
  p_token text,
  p_profile_id uuid,
  p_confirm_mismatch boolean default false
) returns table (
  invite_id uuid,
  team_id uuid,
  team_slug text,
  invite_email text,
  invite_role text,
  email_match boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invite public.team_invites%rowtype;
  v_profile_email text;
  v_team_slug text;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception using errcode = 'P0002', message = 'invite_not_found';
  end if;

  select candidate.*
  into v_invite
  from public.team_invites as candidate
  where candidate.token = p_token
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'invite_not_found';
  end if;
  if v_invite.accepted_at is not null then
    raise exception using errcode = 'P0001', message = 'already_accepted';
  end if;
  if v_invite.expires_at < clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'expired';
  end if;

  select profile.email
  into v_profile_email
  from public.profiles as profile
  where profile.id = p_profile_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'profile_not_found';
  end if;

  email_match :=
    v_profile_email is not null
    and lower(v_profile_email) = lower(v_invite.email);
  if not email_match and not coalesce(p_confirm_mismatch, false) then
    raise exception using errcode = 'P0001', message = 'mismatch_unconfirmed';
  end if;

  insert into public.team_members (
    team_id,
    user_id,
    role,
    invited_by_user_id
  ) values (
    v_invite.team_id,
    p_profile_id,
    v_invite.role,
    v_invite.invited_by_user_id
  )
  on conflict on constraint team_members_pkey do nothing;

  update public.team_invites as claimed
  set accepted_at = clock_timestamp()
  where claimed.id = v_invite.id;

  select team_record.slug
  into v_team_slug
  from public.teams as team_record
  where team_record.id = v_invite.team_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'team_not_found';
  end if;

  invite_id := v_invite.id;
  team_id := v_invite.team_id;
  team_slug := v_team_slug;
  invite_email := v_invite.email;
  invite_role := v_invite.role;
  return next;
end;
$$;

revoke all on function public.accept_team_invite(text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.accept_team_invite(text, uuid, boolean)
  to service_role;
