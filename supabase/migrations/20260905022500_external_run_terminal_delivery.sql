-- Track successful terminal Slack edits independently from run completion.
-- The key includes the call, status, and destination so resumed calls and
-- replacement messages still receive their own result.
alter table public.external_agent_runs
  add column if not exists slack_terminal_notification_key text;
