-- Migration-ledger reconciliation for the agent-node model backfill.
--
-- Production applied the backfill out of band under version 20260726145157
-- before the idempotent, preset-safe migration was committed to git as
-- 20260726100000_backfill_agent_node_model.sql. Keep both versions forever so
-- databases that recorded either version can converge through normal db push.
--
-- The canonical backfill remains in the earlier migration. This statement is
-- intentionally a no-op for databases that still need to record this version.
DO $$
BEGIN
  NULL;
END
$$;
