-- The `labeled` trigger event runs automation jobs whose ai_calls rows carry
-- type = 'labeled'; extend the check constraint to accept it.
ALTER TABLE ai_calls DROP CONSTRAINT IF EXISTS ai_calls_type_check;

ALTER TABLE ai_calls
ADD CONSTRAINT ai_calls_type_check CHECK (
  type IN (
    'chat',
    'pr_review',
    'cron_refactor',
    'cron',
    'agent',
    'push_review',
    'issue_triage',
    'ci_failure',
    'mention',
    'pr_comment',
    'issue_comment',
    'labeled'
  )
);
