-- The agent's answer to a guidance message, posted back into the Slack thread
-- it came from. Expand only: both columns are optional and old readers ignore
-- them. reply_posted_ts is delivery state, not a timestamp column: the Slack
-- message ts once posted, 'skipped:empty' when the answer converts to no
-- text, or 'failed:<slack error>' for an error no retry can fix.
ALTER TABLE public.slack_run_guidance
  ADD COLUMN IF NOT EXISTS reply_text TEXT,
  ADD COLUMN IF NOT EXISTS reply_posted_ts TEXT;
