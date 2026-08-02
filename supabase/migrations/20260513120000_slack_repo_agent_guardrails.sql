-- Slack repo-agent guardrails. Bot tokens are workspace-scoped, so repo-agent
-- execution needs workspace-level policy knobs separate from the installer row.

alter table public.slack_installations
  add column if not exists repo_agent_enabled boolean not null default true,
  add column if not exists allowed_slack_user_ids text[] default null,
  add column if not exists monthly_repo_run_limit integer default null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'slack_installations_monthly_repo_run_limit_positive'
      and conrelid = 'public.slack_installations'::regclass
  ) then
    alter table public.slack_installations
      add constraint slack_installations_monthly_repo_run_limit_positive
      check (monthly_repo_run_limit is null or monthly_repo_run_limit > 0);
  end if;
end $$;

comment on column public.slack_installations.repo_agent_enabled is
  'When false, Slack app mentions in linked channels do not start repo-agent runs.';
comment on column public.slack_installations.allowed_slack_user_ids is
  'Optional Slack user id allowlist for starting repo-agent runs. Null or empty means any mapped Mogplex user may start runs.';
comment on column public.slack_installations.monthly_repo_run_limit is
  'Optional per-workspace monthly repo-agent run limit enforced before creating ai_calls.';

create index if not exists idx_ai_calls_slack_repo_agent_month
  on public.ai_calls ((metadata->>'slack_team_id'), started_at desc)
  where metadata->>'slack_mode' = 'repo_agent';
