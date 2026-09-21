-- A repo excludes a library skill by upserting one override row per
-- (repo, skill). The table shipped without the unique key that upsert names,
-- so every exclusion failed with "no unique or exclusion constraint matching
-- the ON CONFLICT specification" and no repo could ever narrow its skills.
--
-- Repo-only skills keep skill_id null. Nulls are distinct in a unique index,
-- so a repo can still define any number of its own skills.

-- Keep the newest row of any pair a manual insert may have left behind.
delete from public.repo_skill_overrides older
using public.repo_skill_overrides newer
where older.skill_id is not null
  and older.repo_id = newer.repo_id
  and older.skill_id = newer.skill_id
  and (coalesce(older.created_at, 'epoch'::timestamptz), older.id)
    < (coalesce(newer.created_at, 'epoch'::timestamptz), newer.id);

create unique index if not exists idx_repo_skill_overrides_repo_skill
  on public.repo_skill_overrides (repo_id, skill_id);
