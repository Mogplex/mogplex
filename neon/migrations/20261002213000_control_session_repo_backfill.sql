-- Link legacy Control sessions only when their name identifies one accessible
-- repository. Prefer a full name over short-name matches, ignoring case and
-- surrounding whitespace. Sessions have no team scope, so consider personal
-- repos and teams the session owner currently belongs to; never pick between
-- duplicate full names across scopes. Existing links and transcripts survive.
-- Production preflight 2026-10-02: 2 unlinked, 0 unique, 1 ambiguous, 1 unmatched.
-- Report actual backfilled/ambiguous/unmatched counts at migration time as well.
do $$
declare
  linked_count integer;
  ambiguous_count integer;
  unmatched_count integer;
begin
  with legacy as (
    select id, user_id, lower(btrim(project)) as project
    from public.control_sessions
    where repo_id is null
  ), candidates as (
    select s.id as session_id, r.id as repo_id,
      lower(r.full_name) = s.project as exact
    from legacy s
    join public.repos r on (
      (r.owner_type = 'user' and r.owner_user_id = s.user_id
        and r.product_team_id is null)
      or (r.owner_type = 'team' and exists (
        select 1 from public.team_members m
        where m.user_id = s.user_id and m.team_id = r.product_team_id
      ))
    )
    where nullif(s.project, '') is not null and (
      lower(r.full_name) = s.project
      or lower(coalesce(nullif(btrim(r.name), ''), split_part(r.full_name, '/', 2))) = s.project
    )
  ), ranked as (
    select *, bool_or(exact) over (partition by session_id) as has_exact
    from candidates
  ), matches as (
    select session_id, count(*) as match_count, (array_agg(repo_id))[1] as repo_id
    from ranked
    where exact or not has_exact
    group by session_id
  ), updated as (
    update public.control_sessions s
    set repo_id = m.repo_id
    from matches m
    where s.id = m.session_id and s.repo_id is null and m.match_count = 1
    returning s.id
  )
  select (select count(*) from updated),
    (select count(*) from matches where match_count > 1),
    (select count(*) from legacy s where not exists (
      select 1 from matches m where m.session_id = s.id
    ))
  into linked_count, ambiguous_count, unmatched_count;
  raise notice 'Control repo backfill: % linked, % ambiguous, % unmatched',
    linked_count, ambiguous_count, unmatched_count;
end $$;
