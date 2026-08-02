-- Email unsubscribes (global suppression list).
--
-- Canonical "do not send" list keyed by lowercased email. Any sender in the
-- app MUST consult `public.email_unsubscribes` before emitting mail. The
-- entry is created when a recipient confirms an unsubscribe action on
-- `/unsubscribe` or via the RFC 8058 one-click POST.
--
-- Scope is intentionally global (one row per email, not per category). The
-- product currently emits a small number of email types and a single
-- "honor any unsubscribe everywhere" rule is what regulators and inbox
-- providers expect. If categorized opt-outs are needed later, add a
-- nullable `category` column and a partial unique index — do not break the
-- global guarantee.

CREATE TABLE IF NOT EXISTS public.email_unsubscribes (
  email           TEXT        PRIMARY KEY,
  unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Where the unsubscribe came from: 'landing_page' (user clicked + confirmed)
  -- or 'one_click' (RFC 8058 List-Unsubscribe-Post). Free-text for forward
  -- compatibility; the app currently writes only those two values.
  source          TEXT        NOT NULL,
  -- Optional free-text reason, captured if we ever add a "why are you
  -- unsubscribing?" prompt on the landing page. Nullable.
  reason          TEXT,

  CONSTRAINT email_unsubscribes_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT email_unsubscribes_email_shape CHECK (
    char_length(email) BETWEEN 3 AND 320
      AND position('@' IN email) > 1
      AND position('@' IN email) < char_length(email)
  )
);

-- Default-deny RLS. Anonymous/authenticated users never touch this table
-- directly — all reads and writes go through the service-role admin client
-- (the /unsubscribe server action and /api/unsubscribe one-click route).
ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.email_unsubscribes IS
  'Global email suppression list. Every transactional and marketing sender in the app MUST check this table before sending. Populated by the /unsubscribe landing page and the /api/unsubscribe one-click endpoint.';
