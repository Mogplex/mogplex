-- Old app deployments can still issue liveness writes during a new release's
-- resume. A stopped provider observation cannot cancel an owned bootstrap:
-- it may describe the previous session of the same persistent sandbox name.
-- Explicit Stop, billing admission failure and stuck-boot recovery remain valid.
create or replace function public.guard_sandbox_boot_reconciliation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('creating', 'installing')
     and old.last_boot_started_at is not null
     and old.last_boot_completed_at is null
     and new.status = 'stopped'
     and new.stop_reason = 'vm_gone' then
    return null;
  end if;
  return new;
end;
$$;

create trigger sandbox_boot_reconciliation_guard
before update on public.sandboxes
for each row execute function public.guard_sandbox_boot_reconciliation();
