-- Backfill `user_api_keys.scopes` to include 'write' for tokens issued
-- before scope enforcement landed, and update the column default so newly
-- created tokens get both scopes by default until the settings UI exposes
-- the choice.
--
-- Why backfill: POST /api/v1/mogplex/runs (and other mutations) will start
-- requiring the 'write' scope. Tokens currently default to ARRAY['read'],
-- so without this backfill existing automation would suddenly receive 403
-- after the enforcement deploys.
--
-- Why update the default: matches what new tokens are likely to want. The
-- POST /api/settings/api-keys handler accepts a scopes argument in the same
-- PR, so callers that want a read-only token can opt in explicitly.
--
-- Idempotent: re-running the UPDATE just no-ops because the WHERE clause
-- only matches rows that still lack 'write'.
--
-- NULL guard: today scopes is NOT NULL DEFAULT ARRAY['read'], so the
-- IS NULL branch is unreachable. We include it anyway so the backfill
-- stays correct if the column is ever loosened — `NOT ('write' = ANY(NULL))`
-- evaluates to NULL (not TRUE), which would silently skip the row.

BEGIN;

UPDATE user_api_keys
SET scopes = ARRAY['read', 'write']::TEXT[]
WHERE scopes IS NULL OR NOT ('write' = ANY(scopes));

ALTER TABLE user_api_keys
  ALTER COLUMN scopes SET DEFAULT ARRAY['read', 'write']::TEXT[];

COMMIT;
