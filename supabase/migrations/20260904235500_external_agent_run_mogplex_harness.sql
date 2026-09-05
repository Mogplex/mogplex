-- Native Mogplex runs share the existing durable run and billing lifecycle.
alter table public.external_agent_runs
  drop constraint if exists external_agent_runs_harness_check;
alter table public.external_agent_runs
  add constraint external_agent_runs_harness_check
  check (harness in ('mogplex', 'codex', 'claude-code'));
