-- The agent's answer to a guidance message, posted back into the Slack thread
-- it came from. Expand only: both columns are optional and old readers ignore
-- them. reply_posted_ts records the Slack message so delivery posts it once.
ALTER TABLE public.slack_run_guidance
  ADD COLUMN IF NOT EXISTS reply_text TEXT,
  ADD COLUMN IF NOT EXISTS reply_posted_ts TEXT;
