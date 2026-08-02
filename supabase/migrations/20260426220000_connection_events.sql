-- Per-connection failure event log, scoped to a user. Mirrors
-- ai_call_events (see 20260322113000_ai_call_events_control_plane.sql)
-- so existing observability conventions carry over: owner-scoped RLS,
-- JSONB payload, indexes for parent-page and 24h-aggregation queries,
-- service-role inserts only (no INSERT policy = anon/authenticated
-- cannot write through PostgREST; only supabaseAdmin via the logger).
--
-- Persisted event types are intentionally narrow — only failures with
-- a known connection_id. Successful loads, manual test-started markers,
-- and create-failed (which has no connection yet) stay console-only.
-- See lib/connections/logging.ts:EVENT_TO_DB_TYPE for the mapping.
--
-- Surfaces:
--   chat    — runtime load from app/api/chat (lib/agents/tools.ts)
--   harness — runtime load from sandbox harness (lib/harness/mcp-config.ts)
--   test    — manual Test invocation from the connections UI
--   reaper  — cleared by zombie-row-reaper after a stuck testing row
--             timed out (matches the source='zombie-row-reaper'
--             convention used in ai_call_events when the reaper
--             writes terminal events).

-- user_id references public.profiles, NOT auth.users. The parent
-- connections table was re-pointed from auth.users to profiles by
-- migration 20260317020217_fix_user_fk_references_to_profiles, and
-- in the live data set there are profile rows without a matching
-- auth.users row (e.g. profiles that outlived their auth.users
-- entry). Mirroring the parent's FK target keeps every event
-- insertable; FK-ing to auth.users would silently FK-fail under
-- the logger's fire-and-forget catch and drop the entire failure
-- ledger for those users. Diverges from the ai_call_events
-- precedent on this one detail because ai_call_events itself still
-- references auth.users — that's a pre-existing inconsistency in
-- the codebase, not the right model to copy here.
CREATE TABLE IF NOT EXISTS public.connection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.connections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'runtime_load_failed',
      'test_failed',
      'test_persist_failed'
    )
  ),
  surface TEXT NOT NULL CHECK (
    surface IN ('chat', 'harness', 'test', 'reaper')
  ),
  ai_call_id UUID REFERENCES public.ai_calls(id) ON DELETE SET NULL,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent re-target: the table may already exist with the FK
-- pointing at auth.users from an earlier apply of this migration
-- before the parent-table mismatch was caught. Drop and recreate
-- only if the current target is wrong. Safe to re-run; no-op once
-- the FK already points at profiles.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class parent ON parent.oid = c.confrelid
    JOIN pg_namespace ns ON ns.oid = parent.relnamespace
    WHERE c.conname = 'connection_events_user_id_fkey'
      AND ns.nspname = 'auth'
      AND parent.relname = 'users'
  ) THEN
    ALTER TABLE public.connection_events
      DROP CONSTRAINT connection_events_user_id_fkey;
    ALTER TABLE public.connection_events
      ADD CONSTRAINT connection_events_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END
$$;

ALTER TABLE public.connection_events ENABLE ROW LEVEL SECURITY;

-- FOR SELECT only (not FOR ALL like ai_call_events). With RLS
-- enabled and no INSERT/UPDATE/DELETE policy, those operations are
-- denied for the anon and authenticated roles regardless of the
-- default Supabase table grants — RLS requires an *allowing* policy
-- per operation. The service_role key bypasses RLS entirely, so the
-- logger's supabaseAdmin.from(...).insert(...) still works for
-- server-side persistence.
--
-- Owners legitimately need to read their own failure history for
-- the connections-pane and PR B's UI counter, but they have no use
-- case for INSERT (would let a client forge/poison observability
-- events to inflate or hide failures), UPDATE, or DELETE (would let
-- a user silently rewrite their own audit trail). Tightens the
-- blast radius vs. the ai_call_events precedent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connection_events'
      AND policyname = 'owner_select'
  ) THEN
    CREATE POLICY "owner_select" ON public.connection_events
      FOR SELECT USING (user_id = auth.uid());
  END IF;
END
$$;

-- Index strategy mirrors ai_call_events plus an event_type index for
-- the cross-user 24h failure-rate aggregation that /api/observability/stats
-- will add in PR B.
CREATE INDEX IF NOT EXISTS idx_connection_events_connection_created
  ON public.connection_events (connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connection_events_user_created
  ON public.connection_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connection_events_event_type_created
  ON public.connection_events (event_type, created_at DESC);
