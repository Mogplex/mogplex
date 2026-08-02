-- Teams + RBAC Phase 3 (issue #559).
-- teams.model_allowlist: optional list of model IDs (e.g. "openai/gpt-5",
-- "anthropic/claude-sonnet-4-6") the team is allowed to run. NULL = no
-- restriction (default). Empty array = no models allowed (kill-switch).
-- Enforcement lives in lib/ai-model-resolver.ts (admin-set, fail-closed).

alter table public.teams
  add column if not exists model_allowlist text[];

comment on column public.teams.model_allowlist is
  'Allowed model IDs. NULL = unrestricted; empty array = none allowed. Enforced in lib/ai-model-resolver.ts.';
