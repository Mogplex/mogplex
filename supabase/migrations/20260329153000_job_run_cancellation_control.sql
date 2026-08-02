alter table public.job_runs
  drop constraint if exists job_runs_status_check;

alter table public.job_runs
  add constraint job_runs_status_check
  check (status in ('pending', 'running', 'success', 'failed', 'cancelled'));

alter table public.job_runs
  add column if not exists cancel_requested_at timestamptz null,
  add column if not exists cancelled_at timestamptz null,
  add column if not exists cancel_reason text null,
  add column if not exists cancel_error text null;

create index if not exists idx_job_runs_cancel_requested
  on public.job_runs (cancel_requested_at desc)
  where cancel_requested_at is not null;

create index if not exists idx_job_runs_cancelled_at
  on public.job_runs (cancelled_at desc)
  where cancelled_at is not null;

alter table public.flow_node_runs
  drop constraint if exists flow_node_runs_status_check;

alter table public.flow_node_runs
  add constraint flow_node_runs_status_check
  check (status in ('pending', 'running', 'success', 'failed', 'skipped', 'cancelled'));
