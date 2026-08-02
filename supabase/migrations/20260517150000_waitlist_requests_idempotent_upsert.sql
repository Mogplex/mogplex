-- Idempotent fixup for environments that already applied the original
-- 20260517140000_waitlist_requests.sql before its in-place revision in #552:
-- they still have the functional unique index on lower(email) and no
-- updated_at column, so neither the new app code nor the duplicate
-- detection works against them. Re-running the original migration is a
-- no-op there because of CREATE TABLE IF NOT EXISTS.
--
-- This migration is also the canonical home for record_waitlist_request(),
-- the RPC the app now calls instead of doing the upsert client-side. It
-- returns Postgres' `xmax = 0` newly-inserted signal so duplicates are
-- detected deterministically — no updated_at vs created_at window, no
-- sub-1s false-negative on rapid double-submits.

ALTER TABLE public.waitlist_requests
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- The functional unique index cannot satisfy PostgREST's ON CONFLICT target;
-- replace it with a plain UNIQUE constraint. The app already lowercases
-- emails before insert and the CHECK below enforces that on the DB side.
DROP INDEX IF EXISTS public.waitlist_requests_email_lower_unique;

-- CONSTRAINT IF NOT EXISTS isn't available, so guard via pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'waitlist_requests_email_unique'
      AND conrelid = 'public.waitlist_requests'::regclass
  ) THEN
    ALTER TABLE public.waitlist_requests
      ADD CONSTRAINT waitlist_requests_email_unique UNIQUE (email);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'waitlist_requests_email_lowercase'
      AND conrelid = 'public.waitlist_requests'::regclass
  ) THEN
    ALTER TABLE public.waitlist_requests
      ADD CONSTRAINT waitlist_requests_email_lowercase
      CHECK (email = lower(email));
  END IF;
END$$;

-- Service-role-only RPC. PostgREST exposes any function in `public` to
-- anon/authenticated by default; revoke and grant explicitly so this
-- cannot be invoked except via the server-side supabaseAdmin client
-- (which runs behind the rate-limited /api/auth/waitlist/request route).
CREATE OR REPLACE FUNCTION public.record_waitlist_request(
  p_email    TEXT,
  p_name     TEXT,
  p_company  TEXT,
  p_use_case TEXT,
  p_source   TEXT
) RETURNS TABLE(inserted BOOLEAN)
LANGUAGE SQL
AS $$
  INSERT INTO public.waitlist_requests (email, name, company, use_case, source)
  VALUES (p_email, p_name, p_company, p_use_case, p_source)
  ON CONFLICT ON CONSTRAINT waitlist_requests_email_unique DO UPDATE SET
    name       = EXCLUDED.name,
    company    = EXCLUDED.company,
    use_case   = EXCLUDED.use_case,
    source     = EXCLUDED.source,
    updated_at = NOW()
  RETURNING (xmax = 0) AS inserted;
$$;

REVOKE EXECUTE ON FUNCTION public.record_waitlist_request(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_waitlist_request(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.record_waitlist_request(TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Upsert a waitlist request, returning inserted=true on fresh insert and false when the conflict path fired. Service role only.';
