-- The skills library shows "N uses" per skill, but nothing ever wrote
-- usage_count. Skills now reach runs (a user invokes one by name, or an agent
-- loads one), so the count can be real.
--
-- One statement, so concurrent runs never lose an increment the way a
-- read-modify-write from the app would. Scoped by owner: a caller can only
-- ever count against their own skills, whatever ids they pass.
create or replace function public.increment_skill_usage(
  p_user_id uuid, p_skill_ids uuid[]
) returns void
language sql
set search_path = public
as $$
  update public.skills
     set usage_count = coalesce(usage_count, 0) + 1
   where user_id = p_user_id
     and id = any(p_skill_ids);
$$;
revoke all on function public.increment_skill_usage(uuid, uuid[]) from public;
grant execute on function public.increment_skill_usage(uuid, uuid[]) to service_role;
