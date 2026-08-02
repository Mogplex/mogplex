-- Extend the sandbox status and health_status enumerations to include 'paused'.
-- A paused sandbox has its disk state captured in a snapshot (snapshot_id is
-- set) and its VM stopped. Resume spawns a new VM from that snapshot.

ALTER TABLE public.sandboxes
  DROP CONSTRAINT IF EXISTS sandboxes_status_check;

ALTER TABLE public.sandboxes
  ADD CONSTRAINT sandboxes_status_check
    CHECK (status IN ('creating', 'installing', 'running', 'stopped', 'paused', 'error'));

ALTER TABLE public.sandboxes
  DROP CONSTRAINT IF EXISTS sandboxes_health_status_check;

ALTER TABLE public.sandboxes
  ADD CONSTRAINT sandboxes_health_status_check
    CHECK (health_status IN (
      'unknown',
      'starting',
      'running',
      'ready',
      'stopped',
      'paused',
      'error',
      'not_available',
      'idle_warning',
      'app_error',
      'unreachable'
    ));
