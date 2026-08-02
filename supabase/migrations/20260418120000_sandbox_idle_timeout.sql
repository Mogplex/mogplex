-- Separate "idle timeout" (reaper idle cap) from "lifetime timeout" (VM timeout).
-- Both live on workspaces and repos; repo value overrides workspace value.
-- Nullable with no default: NULL means "inherit workspace", and if workspace is
-- NULL too, application code falls back to DEFAULT_SANDBOX_IDLE_TIMEOUT_MS.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS sandbox_idle_timeout_ms INTEGER;

ALTER TABLE public.repos
  ADD COLUMN IF NOT EXISTS sandbox_idle_timeout_ms INTEGER;
