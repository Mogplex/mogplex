-- Add the `awaiting_input` run state for checkpoint pauses: a run that has
-- reached a logical checkpoint (work done and verified) and is waiting for the
-- user before continuing. It is non-terminal and resumable. Drop the existing
-- status CHECK by catalog lookup so this is independent of its generated name.
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.external_agent_runs'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%';

  if constraint_name is not null then
    execute format(
      'alter table public.external_agent_runs drop constraint %I',
      constraint_name
    );
  end if;
end $$;

alter table public.external_agent_runs
  add constraint external_agent_runs_status_check
  check (
    status in (
      'pending',
      'streaming',
      'success',
      'failed',
      'cancelled',
      'awaiting_input'
    )
  );
