ALTER TABLE public.automation_dispatch_events
  DROP CONSTRAINT IF EXISTS automation_dispatch_events_event_kind_check;

ALTER TABLE public.automation_dispatch_events
  ADD CONSTRAINT automation_dispatch_events_event_kind_check
  CHECK (event_kind IN ('enqueue', 'start', 'control'));

ALTER TABLE public.automation_dispatch_events
  DROP CONSTRAINT IF EXISTS automation_dispatch_events_outcome_check;

ALTER TABLE public.automation_dispatch_events
  ADD CONSTRAINT automation_dispatch_events_outcome_check
  CHECK (
    outcome IN (
      'queued',
      'suppressed',
      'started',
      'deferred',
      'start_failed',
      'cancel_requested',
      'cancelled',
      'cancel_failed',
      'reconciled'
    )
  );
