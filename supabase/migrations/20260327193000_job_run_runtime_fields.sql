alter table public.job_runs
  add column if not exists runtime_provider text
  check (runtime_provider is null or runtime_provider in ('workflow', 'trigger'));

alter table public.job_runs
  add column if not exists runtime_run_id text;

update public.job_runs
set
  runtime_provider = coalesce(runtime_provider, 'workflow'),
  runtime_run_id = coalesce(runtime_run_id, workflow_run_id)
where workflow_run_id is not null
  and (runtime_provider is null or runtime_run_id is null);

create index if not exists job_runs_runtime_provider_idx
  on public.job_runs (runtime_provider)
  where runtime_provider is not null;

create index if not exists job_runs_runtime_run_id_idx
  on public.job_runs (runtime_run_id)
  where runtime_run_id is not null;
