-- Waitlist signup requests collected from the public /request-access page.
--
-- Each row is one person asking for early access. An operator later issues
-- them a code from public.waitlist_codes and (optionally) records the link
-- on the request row. Default-deny RLS — only the service role writes here
-- (via the public API route) or reads here (from an admin tool).

CREATE TABLE IF NOT EXISTS public.waitlist_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Always stored lowercase by the app (normalizeWaitlistRequest). The plain
  -- UNIQUE constraint below is what PostgREST's onConflict='email' targets;
  -- a functional unique index on lower(email) cannot satisfy ON CONFLICT.
  email           TEXT        NOT NULL,
  name            TEXT,
  company         TEXT,
  use_case        TEXT,
  source          TEXT        NOT NULL DEFAULT 'marketing_site',
  status          TEXT        NOT NULL DEFAULT 'pending',
  issued_code     TEXT        REFERENCES public.waitlist_codes(code) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT waitlist_requests_email_unique UNIQUE (email),
  CONSTRAINT waitlist_requests_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT waitlist_requests_status_known CHECK (
    status IN ('pending', 'approved', 'rejected')
  ),
  CONSTRAINT waitlist_requests_email_shape CHECK (
    char_length(email) BETWEEN 3 AND 320 AND position('@' IN email) > 1
  )
);

CREATE INDEX IF NOT EXISTS waitlist_requests_status_created_idx
  ON public.waitlist_requests (status, created_at DESC);

ALTER TABLE public.waitlist_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  public.waitlist_requests IS
  'Public waitlist signups from /request-access. Service role only.';
COMMENT ON COLUMN public.waitlist_requests.issued_code IS
  'Operator-assigned access code, once approved. Nullable until approval.';
COMMENT ON COLUMN public.waitlist_requests.source IS
  'Where the signup originated, e.g. marketing_site, slack, referral.';
COMMENT ON COLUMN public.waitlist_requests.updated_at IS
  'Bumped by the app on every upsert. Lets the route distinguish a fresh insert from a duplicate submission without a timing heuristic.';
