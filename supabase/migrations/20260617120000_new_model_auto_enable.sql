-- New-model auto-enable + first-time popup
--
-- New models synced from the AI Gateway are already enabled-by-default for
-- users with no explicit preference row (see resolveUserModelEnabledState).
-- This migration adds the bookkeeping needed to (a) detect which models are
-- new to a given user, (b) show a one-time popup the first time they appear,
-- and (c) let each user turn the auto-adopt behavior off.

-- When a model first entered the catalog. The sync-models cron does not write
-- this column, so existing rows keep their value on upsert and only brand-new
-- rows get DEFAULT now().
ALTER TABLE ai_models
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Backfill: every model present at migration time is "already in the catalog",
-- so date it in the past. This keeps the rollout from popping a dialog that
-- lists the entire existing catalog as new (models synced afterward get
-- DEFAULT now() and are correctly newer than any user's models_seen_at).
UPDATE ai_models SET created_at = '2000-01-01T00:00:00Z';

CREATE INDEX IF NOT EXISTS idx_ai_models_created_at ON ai_models(created_at);

-- Per-user feature flag. When false, new models arrive disabled and no popup
-- is shown. Defaults to true so the auto-adopt behavior is on out of the box.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS auto_enable_new_models BOOLEAN NOT NULL DEFAULT true;

-- High-water mark: models with created_at greater than this are "new" to the
-- user. Defaults to now() so existing users (and any user created later) start
-- with the current catalog already acknowledged.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS models_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
