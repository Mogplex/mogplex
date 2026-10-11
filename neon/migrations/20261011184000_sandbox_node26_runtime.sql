-- Expand accepted runtimes while preserving every existing runtime and NULL
-- auto-detection for retained app releases and Trigger workers.
ALTER TABLE public.repos
  DROP CONSTRAINT repos_runtime_check,
  ADD CONSTRAINT repos_runtime_check
    CHECK (runtime IS NULL OR runtime IN ('node22', 'node24', 'node26', 'python3.13'));

ALTER TABLE public.sandboxes
  DROP CONSTRAINT sandboxes_runtime_check,
  ADD CONSTRAINT sandboxes_runtime_check
    CHECK (runtime IS NULL OR runtime IN ('node22', 'node24', 'node26', 'python3.13'));
