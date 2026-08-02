-- Per-session cost attribution for persistent sandboxes.
--
-- Context: the original sandbox_compute_cost_on_stop trigger (see
-- 20260417120100_sandbox_cost_trigger.sql) fires only on transitions to
-- 'stopped' and measures wall-clock from created_at. Persistent
-- sandboxes span multiple pause/resume cycles under the same record:
-- the create timestamp is fixed but each session has its own boot +
-- run duration, so the legacy math over-counts idle time spent paused.
--
-- Two changes:
--  1. Fire on transitions into 'paused' as well as 'stopped' so each
--     session closes with its own accounting row. We ADD the session
--     duration to compute_seconds / cost_cents_estimate rather than
--     overwriting, so sequential pauses accumulate cost across the
--     record's lifetime.
--  2. Prefer last_boot_started_at as the session start when present
--     (set by transitionSandboxRecordToInstalling on launch/restart/
--     resume). Fall back to created_at for records written before
--     that column was populated.

CREATE OR REPLACE FUNCTION sandbox_compute_cost_on_stop()
RETURNS TRIGGER AS $$
DECLARE
  closing         BOOLEAN;
  session_start   TIMESTAMPTZ;
  session_end     TIMESTAMPTZ;
  session_seconds INT;
  rate            NUMERIC := 0.0028;
  cost_delta      NUMERIC;
BEGIN
  -- Are we closing a session this UPDATE? Valid transitions:
  --   active → stopped  (full teardown)
  --   active → paused   (persistent-sandbox pause)
  closing := (
    NEW.status IN ('stopped', 'paused')
    AND (OLD.status IS NULL OR OLD.status NOT IN ('stopped', 'paused'))
  );

  IF NOT closing THEN
    RETURN NEW;
  END IF;

  session_end := COALESCE(NEW.stopped_at, now());

  -- stopped_at is a record-level field; keep writing it on a
  -- session close so the column still reflects the most recent
  -- terminating transition (stopped OR paused). Consumers that
  -- care about 'fully terminated' should join on status.
  IF NEW.stopped_at IS NULL THEN
    NEW.stopped_at := session_end;
  END IF;

  session_start := COALESCE(OLD.last_boot_started_at, OLD.created_at);
  IF session_start IS NULL THEN
    RETURN NEW;
  END IF;

  session_seconds := GREATEST(
    0,
    EXTRACT(EPOCH FROM (session_end - session_start))::int
  );

  -- If the caller already pre-computed compute_seconds /
  -- cost_cents_estimate for this UPDATE (e.g. to apply a rate
  -- override), trust their values. Otherwise accumulate onto any
  -- prior session totals stored on the row.
  IF NEW.compute_seconds IS NULL OR NEW.compute_seconds = COALESCE(OLD.compute_seconds, 0) THEN
    NEW.compute_seconds := COALESCE(OLD.compute_seconds, 0) + session_seconds;
  END IF;

  IF NEW.cost_cents_estimate IS NULL
     OR NEW.cost_cents_estimate = COALESCE(OLD.cost_cents_estimate, 0)
  THEN
    cost_delta := ROUND(session_seconds * rate, 4);
    NEW.cost_cents_estimate :=
      COALESCE(OLD.cost_cents_estimate, 0) + cost_delta;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sandbox_compute_cost_on_stop ON sandboxes;

CREATE TRIGGER sandbox_compute_cost_on_stop
  BEFORE UPDATE ON sandboxes
  FOR EACH ROW
  EXECUTE FUNCTION sandbox_compute_cost_on_stop();
