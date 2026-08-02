-- Sandbox cost attribution — atomic computation on status transition to 'stopped'.
--
-- Previously stopSandboxRecord ran a SELECT for created_at followed by an
-- UPDATE, which left a TOCTOU window and could silently write a partial row
-- (stopped_at set, compute_seconds/cost_cents_estimate null) if the lookup
-- failed. A BEFORE UPDATE trigger computes the fields in-row so they're
-- always populated consistently.
--
-- The trigger only fills columns that are still NULL in NEW, so callers can
-- still override the default rate by pre-computing cost_cents_estimate before
-- the update (e.g. when PLATFORM_SANDBOX_COST_CENTS_PER_SECOND env var is set).

CREATE OR REPLACE FUNCTION sandbox_compute_cost_on_stop()
RETURNS TRIGGER AS $$
DECLARE
  effective_stopped TIMESTAMPTZ;
  seconds INT;
  rate NUMERIC := 0.0028;
BEGIN
  IF NEW.status = 'stopped' AND (OLD.status IS NULL OR OLD.status <> 'stopped') THEN
    effective_stopped := COALESCE(NEW.stopped_at, now());
    NEW.stopped_at := effective_stopped;

    IF OLD.created_at IS NOT NULL THEN
      seconds := GREATEST(
        0,
        EXTRACT(EPOCH FROM (effective_stopped - OLD.created_at))::int
      );
      IF NEW.compute_seconds IS NULL THEN
        NEW.compute_seconds := seconds;
      END IF;
      IF NEW.cost_cents_estimate IS NULL THEN
        NEW.cost_cents_estimate := ROUND(seconds * rate, 4);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sandbox_compute_cost_on_stop ON sandboxes;

CREATE TRIGGER sandbox_compute_cost_on_stop
  BEFORE UPDATE ON sandboxes
  FOR EACH ROW
  EXECUTE FUNCTION sandbox_compute_cost_on_stop();
