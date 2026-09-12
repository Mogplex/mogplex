-- Retain every existing type while adding Dependabot automation telemetry.
ALTER TABLE public.ai_calls DROP CONSTRAINT IF EXISTS ai_calls_type_check;
ALTER TABLE public.ai_calls ADD CONSTRAINT ai_calls_type_check CHECK (
  type IN (
    'chat', 'pr_review', 'cron_refactor', 'cron', 'agent', 'push_review',
    'issue_triage', 'ci_failure', 'mention', 'pr_comment', 'issue_comment',
    'labeled', 'tag_push', 'dependabot_alert'
  )
);
