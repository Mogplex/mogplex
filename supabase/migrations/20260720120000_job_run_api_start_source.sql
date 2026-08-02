alter table public.job_runs
  drop constraint if exists job_runs_last_start_source_check;

alter table public.job_runs
  add constraint job_runs_last_start_source_check
  check (
    last_start_source in (
      'webhook',
      'cron',
      'repair',
      'manual_retry',
      'queue_release',
      'api'
    )
  );
