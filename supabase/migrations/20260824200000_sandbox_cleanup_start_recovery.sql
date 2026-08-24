alter table public.sandbox_lifecycle_events
  drop constraint if exists sandbox_lifecycle_events_event_type_check;

alter table public.sandbox_lifecycle_events
  add constraint sandbox_lifecycle_events_event_type_check
  check (
    event_type in (
      'tab_attached',
      'tab_released',
      'auto_pause_queued',
      'auto_pause_decision',
      'auto_pause_succeeded',
      'auto_pause_failed',
      'resume_after_auto_pause',
      'start_waiting_cleanup',
      'start_cleanup_recovered',
      'start_cleanup_failed',
      'duplicate_start_joined'
    )
  );

comment on column public.sandbox_lifecycle_events.event_type is
  'Lifecycle event names include client presence, auto-pause, cleanup/start recovery, and duplicate-start joins.';
