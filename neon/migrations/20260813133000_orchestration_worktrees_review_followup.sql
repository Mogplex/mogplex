-- Reviewer follow-up for the first-class worktree rollout. This is a separate
-- forward migration because 20260813120000 may already be applied in production.

alter table public.orchestration_tasks
  drop constraint if exists orchestration_tasks_worktree_identity_fk;

alter table public.orchestration_tasks
  add constraint orchestration_tasks_worktree_identity_fk
  foreign key (worktree_id, id, run_id, repo_id)
  references public.orchestration_worktrees (id, task_id, run_id, repo_id)
  on delete set null (worktree_id);

-- Existing repository-linked Control sessions are missions too. Give each a
-- deterministic run so worktree tools are available immediately after deploy.
with inserted_runs as (
  insert into public.orchestration_runs
    (user_id, repo_id, title, slug, request, base_branch, spec_branch,
     integration_branch, metadata)
  select
    session.user_id,
    session.repo_id,
    session.title,
    'control-' || replace(session.id::text, '-', ''),
    session.title,
    coalesce(nullif(repo.default_branch, ''), 'main'),
    'mogplex/spec/control-' || replace(session.id::text, '-', ''),
    'mogplex/integrate/control-' || replace(session.id::text, '-', ''),
    jsonb_build_object('controlSessionId', session.id, 'backfilled', true)
  from public.control_sessions session
  left join public.repos repo on repo.id = session.repo_id
  where session.repo_id is not null
    and session.orchestration_run_id is null
  returning id, metadata
)
update public.control_sessions session
set orchestration_run_id = inserted.id
from inserted_runs inserted
where session.id = (inserted.metadata->>'controlSessionId')::uuid;
