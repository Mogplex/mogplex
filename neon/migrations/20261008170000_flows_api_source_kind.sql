-- Automations started by an integration (start event `api`) record that
-- trigger kind on the flow. Widening the check is additive: every value an
-- earlier release writes stays valid, and no stored row changes meaning.
alter table public.flows drop constraint if exists flows_source_kind_check;
alter table public.flows add constraint flows_source_kind_check
  check (source_kind = any (array['github', 'schedule', 'webhook', 'slack', 'api']));
