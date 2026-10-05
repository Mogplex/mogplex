-- Both team controls are opt-in. Existing teams and retained releases keep
-- their previous contracts; nothing is removed or reinterpreted.
alter table public.teams
  add column if not exists github_merge_require_approval boolean not null default false,
  add column if not exists github_merge_context_repo_only boolean not null default false;

create table public.github_merge_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  target_owner text not null,
  target_repo text not null,
  pr_number integer not null check (pr_number > 0),
  head_sha text not null check (head_sha ~ '^[a-f0-9]{40}$'),
  commit_title text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','denied','consumed')),
  requested_ai_call_id uuid,
  requested_event_id text,
  consumed_ai_call_id uuid,
  consumed_event_id text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  consumed_at timestamptz
);

create unique index github_merge_approvals_pending_target on public.github_merge_approvals
  (user_id,team_id,target_owner,target_repo,pr_number,head_sha,commit_title)
  where status = 'pending';
alter table public.github_merge_approvals enable row level security;
create policy github_merge_approvals_service_role on public.github_merge_approvals
  to service_role using (true) with check (true);

create function public.request_github_merge_approval(
  p_user_id uuid, p_team_id uuid, p_owner text, p_repo text, p_pr_number integer,
  p_head_sha text, p_commit_title text, p_ai_call_id uuid, p_request_id text
) returns uuid language plpgsql as $$
declare approval_id uuid;
begin
  insert into public.github_merge_approvals
    (user_id,team_id,target_owner,target_repo,pr_number,head_sha,commit_title,requested_ai_call_id,requested_event_id)
  values (p_user_id,p_team_id,lower(p_owner),lower(p_repo),p_pr_number,lower(p_head_sha),p_commit_title,p_ai_call_id,p_request_id)
  on conflict (user_id,team_id,target_owner,target_repo,pr_number,head_sha,commit_title) where status = 'pending'
  do nothing;
  select id into approval_id from public.github_merge_approvals
  where user_id=p_user_id and team_id=p_team_id and target_owner=lower(p_owner)
    and target_repo=lower(p_repo) and pr_number=p_pr_number and head_sha=lower(p_head_sha)
    and commit_title=p_commit_title and status='pending';
  return approval_id;
end;
$$;

-- Only a resolved human approval for this exact user/team/target/head/title
-- can be consumed. Mark it consumed before any GitHub write, once only.
-- A failed merge does not replay the approval automatically.
create function public.claim_github_merge_approval(
  p_user_id uuid, p_team_id uuid, p_owner text, p_repo text, p_pr_number integer,
  p_head_sha text, p_commit_title text, p_ai_call_id uuid, p_request_id text
) returns uuid language plpgsql as $$
declare approval_id uuid;
begin
  update public.github_merge_approvals
  set status='consumed', consumed_at=now(), consumed_ai_call_id=p_ai_call_id,
      consumed_event_id=p_request_id
  where id = (
    select id from public.github_merge_approvals
    where user_id=p_user_id and team_id=p_team_id and target_owner=lower(p_owner)
      and target_repo=lower(p_repo) and pr_number=p_pr_number and head_sha=lower(p_head_sha)
      and commit_title=p_commit_title and status='approved'
    order by resolved_at desc, id limit 1 for update skip locked
  ) returning id into approval_id;
  return approval_id;
end;
$$;

revoke all on table public.github_merge_approvals from public;
revoke all on function public.request_github_merge_approval(uuid,uuid,text,text,integer,text,text,uuid,text) from public;
revoke all on function public.claim_github_merge_approval(uuid,uuid,text,text,integer,text,text,uuid,text) from public;
-- Neon does not require Supabase's optional end-user roles to exist.
do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname=role_name) then
      execute format('revoke all on table public.github_merge_approvals from %I', role_name);
      execute format('revoke all on function public.request_github_merge_approval(uuid,uuid,text,text,integer,text,text,uuid,text) from %I', role_name);
      execute format('revoke all on function public.claim_github_merge_approval(uuid,uuid,text,text,integer,text,text,uuid,text) from %I', role_name);
    end if;
  end loop;
end;
$$;
grant select, insert, update, delete on table public.github_merge_approvals to service_role;
grant execute on function public.request_github_merge_approval(uuid,uuid,text,text,integer,text,text,uuid,text) to service_role;
grant execute on function public.claim_github_merge_approval(uuid,uuid,text,text,integer,text,text,uuid,text) to service_role;
