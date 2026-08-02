-- Document the reconciler's cost model in the database, where the next person
-- to touch it will actually see it (\df+ / pg_get_functiondef).
--
-- Review raised that upgrade_deprecated_model_pins() builds its candidate set
-- as profiles CROSS JOIN model_supersessions_effective, so its cost tracks
-- total profiles rather than the handful of users who actually hold a
-- deprecated pin. That is a deliberate trade-off, not an oversight: at current
-- scale (single-digit profiles, single-digit flows, 6 effective supersessions)
-- the cross join is tens of rows, and the simple form is the one covered
-- end-to-end by tests/db/model-supersessions.test.ts. Narrowing the set first
-- would add a three-source pre-filter (agents.model, profiles.default_model,
-- and flow node overrides) for no present benefit.
--
-- The COMMENT records when to revisit so the decision is not silently
-- inherited as scale changes.
COMMENT ON FUNCTION public.upgrade_deprecated_model_pins() IS
  'Repoints saved model references (flows.draft_graph agent modelOverride, agents.model, profiles.default_model) at the successor recorded in model_supersessions. Called by /api/cron/sync-models. Guards, all fail-closed: successor must appear in model_supersessions_effective; profiles.auto_enable_new_models must be true; the user must not have explicitly disabled the successor; and no team the user belongs to may permit the deprecated model while forbidding the successor. Deliberately does NOT touch flow_versions.graph (immutable published snapshots — the runtime resolver in lib/models/supersession-runtime.ts handles those at invocation time) or ai_calls.model (historical cost attribution). COST: the candidate set is profiles CROSS JOIN model_supersessions_effective, rebuilt every run, so cost scales with total profiles rather than affected pins. Intentional at current scale; if profiles exceed ~10k or this shows up in cron timings, pre-filter the candidate set to users who actually hold a deprecated pin before applying the consent guards.';

COMMENT ON TABLE public.model_supersessions IS
  'Deprecated model id -> the model that replaced it, recorded when the sync cron retires an Anthropic model because a newer same-priced version of the same family shipped. Rows are terminal: a deprecated id always points directly at a model that is not itself deprecated (maintained by planSupersessionWrites in lib/models/model-supersessions.ts). Read via model_supersessions_effective, which additionally filters to successors the catalog is currently offering.';
