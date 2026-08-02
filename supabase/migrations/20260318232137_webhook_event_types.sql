-- Expand assignment types for new webhook events
ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_type_check;
ALTER TABLE assignments ADD CONSTRAINT assignments_type_check
  CHECK (type IN ('pr_review', 'cron_refactor', 'cron', 'push_review', 'issue_triage', 'ci_failure'));

-- Expand ai_calls type for observability
ALTER TABLE ai_calls DROP CONSTRAINT IF EXISTS ai_calls_type_check;
ALTER TABLE ai_calls ADD CONSTRAINT ai_calls_type_check
  CHECK (type IN ('chat', 'pr_review', 'cron_refactor', 'agent', 'push_review', 'issue_triage', 'ci_failure'));;
