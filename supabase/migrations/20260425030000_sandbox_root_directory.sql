-- Per-launch root_directory on sandboxes.
--
-- Until now the working subdirectory for a sandbox came from the repo row
-- (repos.root_directory). That meant launching a sandbox at a different
-- monorepo workspace required either editing repo settings (clobbering the
-- default) or creating a separate "space" repo row up front. The launch UI
-- couldn't override per-sandbox.
--
-- Add sandboxes.root_directory so each sandbox carries its own working
-- subdirectory, decoupled from the repo's persistent default. The column is
-- nullable. After the backfill below runs, the post-migration semantics
-- of NULL are:
--
--   - the sandbox was launched at the repo root (either explicitly via the
--     "Repo root" launch option, or because repos.root_directory was also
--     NULL when the row was created or backfilled).
--
-- Callers that read from this column should NOT fall back to
-- repos.root_directory at query time — the backfill makes the column
-- self-contained, and a runtime fallback would silently relocate
-- sandboxes that were intentionally launched at the repo root into the
-- repo's monorepo subdirectory. The only legitimate fallback is when a
-- legacy SELECT string omits the column entirely (record.root_directory
-- is undefined rather than null), which is what
-- loadOwnedSandboxRouteContext checks for.
--
-- Backfill from repos.root_directory on existing rows: any sandbox that
-- predates this column was implicitly running at repos.root_directory
-- (whatever value the repo had at the time), so copy that into the new
-- column to preserve the path each sandbox was actually booted at.
--
-- Caveat: if a repo's root_directory was changed between the original
-- sandbox launch and this migration, the backfilled value will be the
-- repo's CURRENT setting, not the path the sandbox originally booted at.
-- That's the best we can recover without launch-time history. Resume
-- and restart now trust this column verbatim, so a stale backfill
-- could relocate a resumed sandbox into the repo's new subdirectory.
-- For most installations the repo's root_directory is set once and
-- left alone, so this is acceptable; users can re-launch any affected
-- sandbox to pick up the new explicit path.

ALTER TABLE public.sandboxes
  ADD COLUMN IF NOT EXISTS root_directory TEXT;

UPDATE public.sandboxes s
SET root_directory = r.root_directory
FROM public.repos r
WHERE s.repo_id = r.id
  AND s.root_directory IS NULL
  AND r.root_directory IS NOT NULL;

-- Replace the per-branch active-sandbox unique index from
-- 20260404153000_branch_unique_active_sandboxes.sql with one scoped by
-- root_directory as well. Without this, launching a second sandbox on
-- (user, repo, branch, apps/admin) collides with an existing
-- (user, repo, branch, apps/web) on the old index, the INSERT fails
-- with 23505, and the new launch is rejected — defeating the headline
-- promise of this PR (concurrent sandboxes per workspace).
--
-- Use NULLS NOT DISTINCT (Postgres 15+) so two NULL root_directory rows
-- are treated as duplicates. Without this clause, two rapid "repo root"
-- launches on the same branch would each create distinct rows because
-- Postgres considers NULL ≠ NULL in default unique indexes — both rows
-- would slip past getActiveSandboxForRepo's deduplication race window
-- and the user would end up with two billed sandboxes, only one of
-- which would be reachable via the launch UI (ORDER BY created_at DESC).
--
-- Deploy-window caveat: production runs the schema-first deploy
-- (migrations apply before the app rolls out). Order matters: build
-- the new partial unique index FIRST, then drop the old one. Doing it
-- the other way around would open a brief window where neither
-- uniqueness constraint is active. Both statements run inside the
-- migration's transaction, but Postgres only enforces a uniqueness
-- check on inserts that hit a built index — so creating the new one
-- before dropping the old keeps at least one active constraint at
-- every moment.
CREATE UNIQUE INDEX IF NOT EXISTS sandboxes_one_active_branch_root_per_repo_user_idx
  ON public.sandboxes (user_id, repo_id, working_branch, root_directory)
  NULLS NOT DISTINCT
  WHERE repo_id IS NOT NULL
    AND working_branch IS NOT NULL
    AND status IN ('creating', 'installing', 'running');

DROP INDEX IF EXISTS public.sandboxes_one_active_branch_per_repo_user_idx;

-- Non-unique helper index supporting the path-scoped active lookup
-- (used by getActiveSandboxForRepo's eq("root_directory", …) filter).
CREATE INDEX IF NOT EXISTS sandboxes_repo_branch_root_idx
  ON public.sandboxes (repo_id, user_id, working_branch, root_directory)
  WHERE status IN ('creating', 'installing', 'running');
