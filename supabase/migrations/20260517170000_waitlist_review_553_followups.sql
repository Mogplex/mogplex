-- PR #553 review followups.
--
-- 1. record_waitlist_request: when a returning user resubmits without filling
--    optional fields, the original ON CONFLICT path overwrote name/company/
--    use_case with NULL. Switch to COALESCE so previously stored values are
--    preserved when the new payload omits them.
--
-- 2. mint_waitlist_replacement_code: previously appended a new row on every
--    call without expiring earlier replacement codes for the same email. The
--    public route is rate-limited per IP, but the shared "unknown" bucket
--    plus IP rotation lets a determined attacker accumulate live codes for a
--    target. Invalidate any prior unexpired replacement codes for the user
--    before minting, capping live codes at one per email.
--
-- 3. CREATE OR REPLACE FUNCTION recreates the function body but does NOT
--    reset GRANT/REVOKE. The original migration set service-role-only
--    privileges, but any future CREATE OR REPLACE that omits the REVOKE/GRANT
--    block silently restores default PostgREST exposure to anon and
--    authenticated. Re-apply both here and leave a comment on each function
--    pointing to this hazard.

-- ---------------------------------------------------------------------------
-- record_waitlist_request: preserve optional fields under ON CONFLICT.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_waitlist_request(
  p_email    TEXT,
  p_name     TEXT,
  p_company  TEXT,
  p_use_case TEXT,
  p_source   TEXT
) RETURNS TABLE(inserted BOOLEAN)
LANGUAGE SQL
AS $$
  -- COALESCE(EXCLUDED.col, col) keeps the stored value when the resubmitted
  -- payload omits an optional field. Empty strings are normalized to NULL by
  -- the route layer, so this also protects against accidental blanking.
  -- `source` and `updated_at` always reflect the latest submission.
  --
  -- Isolation assumption: `xmax = 0` is the standard MVCC trick for telling
  -- INSERT from UPDATE on an upsert RETURNING clause, and it is reliable
  -- under READ COMMITTED (PostgREST's default isolation). Under REPEATABLE
  -- READ or SERIALIZABLE the freshly-inserted row's xmax can be non-zero in
  -- some snapshot-conflict paths, which would yield a false `inserted=false`.
  -- PostgREST does not run RPCs under elevated isolation, so this is safe
  -- in production; callers running this function from a non-PostgREST
  -- session at higher isolation should not rely on `inserted` being exact.
  INSERT INTO public.waitlist_requests (email, name, company, use_case, source)
  VALUES (p_email, p_name, p_company, p_use_case, p_source)
  ON CONFLICT ON CONSTRAINT waitlist_requests_email_unique DO UPDATE SET
    name       = COALESCE(EXCLUDED.name,     public.waitlist_requests.name),
    company    = COALESCE(EXCLUDED.company,  public.waitlist_requests.company),
    use_case   = COALESCE(EXCLUDED.use_case, public.waitlist_requests.use_case),
    source     = EXCLUDED.source,
    updated_at = NOW()
  RETURNING (xmax = 0) AS inserted;
$$;

-- IMPORTANT: CREATE OR REPLACE does NOT reset privileges, but it also does not
-- preserve them across schema-level GRANT changes elsewhere. Always re-apply
-- the REVOKE/GRANT block in any migration that touches this function.
REVOKE EXECUTE ON FUNCTION public.record_waitlist_request(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_waitlist_request(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.record_waitlist_request(TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Upsert a waitlist request, returning inserted=true on fresh insert and false when the conflict path fired. Optional fields are preserved with COALESCE. Service role only — any migration that recreates this function MUST re-apply the REVOKE/GRANT below it, because CREATE OR REPLACE does not reset privileges.';

-- ---------------------------------------------------------------------------
-- mint_waitlist_replacement_code: invalidate prior live codes for the email.
-- ---------------------------------------------------------------------------
--
-- The hot path is the equality filter `WHERE note = v_note` inside
-- `mint_waitlist_replacement_code` — a plain btree handles that perfectly.
-- A partial index with `WHERE expires_at > NOW()` is not possible because
-- NOW() is not immutable, so use an unconditional btree on `note`.
--
-- The operator hand-delivery lookup documented in
-- `lib/email/send-waitlist-replacement-code.ts` uses
-- `note ILIKE 'replacement for ' || email`, which a default-locale btree
-- will not accelerate. That is acceptable here: hand-delivery is a fallback
-- path with near-zero volume (only runs when RESEND_API_KEY is unset), so
-- a seq scan is the correct trade-off versus carrying a second index.
CREATE INDEX IF NOT EXISTS waitlist_codes_note_idx
  ON public.waitlist_codes (note);



CREATE OR REPLACE FUNCTION public.mint_waitlist_replacement_code(
  p_email TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_code    TEXT;
  v_note    TEXT;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(p_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_note := 'replacement for ' || lower(p_email);

  -- Cap live replacement codes at one per email. Without this, a caller who
  -- can defeat the per-IP rate limit (e.g. by landing in the shared "unknown"
  -- XFF bucket or rotating IPs) can stockpile live single-use codes for a
  -- target address. Expiring instead of deleting preserves the audit row.
  UPDATE public.waitlist_codes
  SET    expires_at = NOW()
  WHERE  note = v_note
    AND  expires_at > NOW();

  v_code := 'r-' || encode(gen_random_bytes(8), 'hex');

  INSERT INTO public.waitlist_codes (code, note, max_uses, expires_at)
  VALUES (
    v_code,
    v_note,
    1,
    NOW() + INTERVAL '24 hours'
  );

  RETURN v_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mint_waitlist_replacement_code(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mint_waitlist_replacement_code(TEXT)
  TO service_role;

COMMENT ON FUNCTION public.mint_waitlist_replacement_code(TEXT) IS
  'Mint a single-use 24h replacement waitlist code for an existing auth user, or return NULL if the email is unknown. Expires any prior live replacement codes for the same email before minting. Service role only — any migration that recreates this function MUST re-apply the REVOKE/GRANT below it, because CREATE OR REPLACE does not reset privileges.';
