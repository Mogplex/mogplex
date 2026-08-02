DROP INDEX IF EXISTS public.idx_flows_legacy_trigger_id;
DROP INDEX IF EXISTS public.idx_triggers_flow_id;

ALTER TABLE public.triggers
  DROP COLUMN IF EXISTS flow_id CASCADE,
  DROP COLUMN IF EXISTS flow_version_id CASCADE;

ALTER TABLE public.flows
  DROP COLUMN IF EXISTS legacy_trigger_id CASCADE;
