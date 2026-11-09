-- Delete a user's personal repository rows that came from the legacy OAuth
-- sync (every repository the GitHub account could see) and were never used.
-- Such rows have no GitHub App installation, so GitHub sends no webhooks for
-- them and App deployments already hide them everywhere.
--
-- Only rows nothing refers to are deleted. Several tables cascade from
-- repos (sandboxes, assignments, connections, external_agent_runs, overrides,
-- Slack links), so the guard checks every foreign key into repos, the
-- repo_id columns that have no foreign key (control sessions, orchestration),
-- the name-based references (control_sessions.project,
-- review_findings.repo_full_name) and job_runs.metadata->>'repo_id'. A row
-- that carries settings the user set (favorite, env vars, commands, runtime,
-- Vercel link, snapshot, ...) is kept too. default_branch is not checked:
-- sync copies it from GitHub, so it says nothing about the user. Keeping a
-- row is always safe; deleting one that is still in use is not. Hidden
-- (removed) rows are deleted on purpose: they are the bulk of the legacy set.
--
-- Expand only: a new function, no change to any table.
create or replace function public.prune_unconnected_repos(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_user_id is null then
    return 0;
  end if;

  -- Lock the candidates first. This only orders writers that go through a
  -- foreign key: they hold a key-share lock on the repo row, so this waits
  -- for them to commit and the delete below (a new statement, so a new
  -- snapshot) sees their reference; later ones wait for this transaction and
  -- then fail their foreign key check. The hand-written guards
  -- (control_sessions.repo_id and project, orchestration_*.repo_id,
  -- job_runs.metadata, review_findings.repo_full_name) take no such lock and
  -- are best effort. App deployments hide these rows everywhere, so nothing
  -- should be writing new references to them; the window is theoretical.
  perform 1
  from public.repos r
  where r.owner_type = 'user'
    and r.owner_user_id = p_user_id
    and r.product_team_id is null
    and r.github_installation_id is null
  for update;

  -- Users with no legacy rows have no candidates; skip the guard.
  if not found then
    return 0;
  end if;

  -- Same candidate predicate as the lock above; keep the two identical.
  delete from public.repos r
  where r.owner_type = 'user'
    and r.owner_user_id = p_user_id
    and r.product_team_id is null
    and r.github_installation_id is null
    -- Settings stored on the row itself: a row the user configured is kept.
    and not r.is_favorite
    and not r.is_monorepo
    and r.sandbox_env_vars = '{}'::jsonb
    and r.install_command is null
    and r.dev_command is null
    and r.root_directory is null
    and r.runtime is null
    and r.sandbox_timeout_ms is null
    and r.sandbox_idle_timeout_ms is null
    and r.dev_port = 3000
    and r.dev_port_auto
    and r.env_sync_mode = 'sandbox-only'
    and r.sandbox_billing_target = 'personal'
    and r.sandbox_billing_mode_override is null
    and r.vercel_project_id is null
    and r.vercel_team_id is null
    and r.webhook_secret is null
    and r.snapshot_id is null
    and r.snapshot_build_token is null
    and r.snapshot_created_at is null
    and not exists (select 1 from public.repos x where x.parent_repo_id = r.id)
    and not exists (select 1 from public.ai_call_events x where x.repo_id = r.id)
    and not exists (select 1 from public.ai_calls x where x.repo_id = r.id)
    and not exists (select 1 from public.assignments x where x.repo_id = r.id)
    and not exists (select 1 from public.automation_dispatch_events x where x.repo_id = r.id)
    and not exists (select 1 from public.connections x where x.repo_id = r.id)
    and not exists (
      select 1 from public.control_sessions x
      where x.repo_id = r.id or x.project = r.full_name
    )
    and not exists (select 1 from public.conversations x where x.repo_id = r.id)
    and not exists (select 1 from public.decision_events x where x.repo_id = r.id)
    and not exists (select 1 from public.external_agent_runs x where x.repo_id = r.id)
    and not exists (select 1 from public.flow_waits x where x.repo_id = r.id)
    and not exists (
      select 1 from public.job_runs x where x.metadata->>'repo_id' = r.id::text
    )
    and not exists (select 1 from public.limit_events x where x.repo_id = r.id)
    and not exists (select 1 from public.orchestration_events x where x.repo_id = r.id)
    and not exists (select 1 from public.orchestration_runs x where x.repo_id = r.id)
    and not exists (select 1 from public.orchestration_tasks x where x.repo_id = r.id)
    and not exists (select 1 from public.orchestration_worktrees x where x.repo_id = r.id)
    and not exists (select 1 from public.repo_connection_overrides x where x.repo_id = r.id)
    and not exists (select 1 from public.repo_model_overrides x where x.repo_id = r.id)
    and not exists (select 1 from public.repo_rule_overrides x where x.repo_id = r.id)
    and not exists (select 1 from public.repo_skill_overrides x where x.repo_id = r.id)
    and not exists (
      select 1 from public.review_findings x
      where x.repo_id = r.id or x.repo_full_name = r.full_name
    )
    and not exists (select 1 from public.sandbox_launch_presets x where x.repo_id = r.id)
    and not exists (select 1 from public.sandboxes x where x.repo_id = r.id)
    and not exists (select 1 from public.slack_channel_links x where x.repo_id = r.id)
    and not exists (select 1 from public.slack_connection_requests x where x.repo_id = r.id)
    and not exists (select 1 from public.team_audit_events x where x.repo_id = r.id);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_unconnected_repos(uuid) from public;
grant execute on function public.prune_unconnected_repos(uuid) to service_role;

-- Default privileges can grant execute to the API roles directly, which the
-- revoke from public does not undo. Those roles exist only on some databases.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format(
        'revoke all on function public.prune_unconnected_repos(uuid) from %I',
        v_role
      );
    end if;
  end loop;
end;
$$;
