-- Link job_runs to triggers (trigger-based jobs don't have an assignment)
ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS trigger_id UUID REFERENCES triggers(id) ON DELETE SET NULL;

-- Make assignment_id nullable for trigger-originated jobs
ALTER TABLE job_runs ALTER COLUMN assignment_id DROP NOT NULL;
