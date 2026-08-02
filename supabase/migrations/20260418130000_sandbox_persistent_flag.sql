-- Track whether a sandbox is persistent (auto-snapshots state between
-- sessions). Set to TRUE for all rows going forward; the beta
-- @vercel/sandbox SDK makes persistent the default.
-- Reaper + pause flow branch on this column: soft-stop (resumable) for
-- persistent, hard-stop for legacy/ephemeral.

ALTER TABLE public.sandboxes
  ADD COLUMN IF NOT EXISTS persistent BOOLEAN NOT NULL DEFAULT TRUE;
