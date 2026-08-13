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
-- repos is still a mirrored pre-cutover table, so reference it only through
-- dynamic SQL when it exists; fresh Neon migration replays fall back to main.
do $block$
declare
  v_base_branch_sql text := quote_literal('main');
begin
  if to_regclass('public.repos') is not null then
    v_base_branch_sql :=
      'coalesce((select nullif(repo.default_branch, '''')'
      || ' from public.repos repo where repo.id = session.repo_id), ''main'')';
  end if;

  execute format($sql$
    with candidate_sessions as (
      select
        session.*,
        'control-' || replace(session.id::text, '-', '') as run_slug
      from public.control_sessions session
      where session.repo_id is not null
        and session.orchestration_run_id is null
    ),
    inserted_runs as (
      insert into public.orchestration_runs
        (user_id, repo_id, title, slug, request, base_branch, spec_branch,
         integration_branch, metadata)
      select
        session.user_id,
        session.repo_id,
        coalesce(nullif(left(session.title, 500), ''), 'New session'),
        session.run_slug,
        coalesce(nullif(left(session.title, 500), ''), 'New session'),
        %s,
        'mogplex/spec/control-' || replace(session.id::text, '-', ''),
        'mogplex/integrate/control-' || replace(session.id::text, '-', ''),
        jsonb_build_object('controlSessionId', session.id, 'backfilled', true)
      from candidate_sessions session
      on conflict (repo_id, slug) do nothing
      returning id, repo_id, slug, metadata
    ),
    resolved_runs as (
      select
        (inserted.metadata->>'controlSessionId')::uuid as session_id,
        inserted.id as run_id
      from inserted_runs inserted
      union all
      select session.id, existing.id
      from candidate_sessions session
      join public.orchestration_runs existing
        on existing.repo_id = session.repo_id
       and existing.slug = session.run_slug
    )
    update public.control_sessions session
    set orchestration_run_id = resolved.run_id
    from resolved_runs resolved
    where session.id = resolved.session_id
      and session.orchestration_run_id is null
  $sql$, v_base_branch_sql);
end
$block$;
