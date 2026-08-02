-- Sandbox cost attribution columns.
-- Adds stopped_at, compute_seconds, cost_cents_estimate to sandboxes so every
-- stopped run captures wall-clock compute and an estimated cost for unit
-- economics telemetry. All columns nullable for backward compatibility.

ALTER TABLE sandboxes
  ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compute_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS cost_cents_estimate NUMERIC(10, 4);

CREATE INDEX IF NOT EXISTS idx_sandboxes_user_stopped
  ON sandboxes (user_id, stopped_at DESC)
  WHERE stopped_at IS NOT NULL;
