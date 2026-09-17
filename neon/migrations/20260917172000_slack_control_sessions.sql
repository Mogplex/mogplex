-- Slack execution remains owned by external_agent_runs. Control stores a
-- durable reference to that run, not a second agent or orchestration job.
alter table public.control_sessions
  add column if not exists external_run_id uuid
  references public.external_agent_runs(id) on delete set null;
create unique index if not exists control_sessions_external_run_id_idx
  on public.control_sessions(external_run_id) where external_run_id is not null;

create or replace function public.create_slack_control_session()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.metadata->>'run_origin' = 'slack' then
    insert into public.control_sessions
      (id,user_id,title,project,repo_id,external_run_id,created_at,updated_at)
    select new.id,new.user_id,
      left(coalesce(nullif(btrim(new.metadata->>'slack_task_title'),''),new.prompt),160),
      r.full_name,new.repo_id,new.id,new.created_at,new.updated_at
    from public.repos r where r.id=new.repo_id
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists external_run_control_session on public.external_agent_runs;
create trigger external_run_control_session after insert on public.external_agent_runs
  for each row execute function public.create_slack_control_session();

-- Include already accepted Slack work, including failed or paused runs.
-- Never overwrite an existing conversation, rename, pin, or archive choice.
insert into public.control_sessions
  (id,user_id,title,project,repo_id,external_run_id,created_at,updated_at)
select e.id,e.user_id,
  left(coalesce(nullif(btrim(e.metadata->>'slack_task_title'),''),e.prompt),160),
  r.full_name,e.repo_id,e.id,e.created_at,e.updated_at
from public.external_agent_runs e join public.repos r on r.id=e.repo_id
where e.metadata->>'run_origin'='slack'
on conflict do nothing;
