alter table sandboxes
  add column stop_reason text
  check (
    stop_reason in (
      'idle_timeout',
      'lifetime_timeout',
      'manual',
      'stuck_boot',
      'vm_gone',
      'unknown'
    )
  );
