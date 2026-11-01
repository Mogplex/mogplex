-- Retain cancelled requests as tombstones so a retried Slack event cannot
-- recreate an authorization prompt the user already dismissed.
alter table public.slack_connection_requests
  add column cancelled_at timestamptz;
