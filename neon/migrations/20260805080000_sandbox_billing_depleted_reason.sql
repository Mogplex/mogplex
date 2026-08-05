alter table public.sandboxes
  drop constraint if exists sandboxes_stop_reason_check;

alter table public.sandboxes
  add constraint sandboxes_stop_reason_check
  check (
    stop_reason in (
      'idle_timeout',
      'lifetime_timeout',
      'manual',
      'stuck_boot',
      'vm_gone',
      'auto_pause',
      'billing_depleted',
      'unknown'
    )
  );
