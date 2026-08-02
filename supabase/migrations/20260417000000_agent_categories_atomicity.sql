-- Atomic helpers for agent_categories to close races and partial-failure windows
-- that the /api/agent-categories route cannot fix in application code.

-- INSERT-time limit so the per-user category cap cannot be exceeded under
-- concurrent requests. The application still performs a friendlier pre-check.
create or replace function public.agent_categories_enforce_limit()
returns trigger
language plpgsql
as $$
declare
  category_count int;
begin
  -- Serialize concurrent inserts for the same user so the count check is
  -- accurate under concurrency. Lock is released at transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended(new.user_id::text, 5503)
  );

  select count(*) into category_count
  from public.agent_categories
  where user_id = new.user_id;

  if category_count >= 50 then
    raise exception 'Category limit reached'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists agent_categories_limit on public.agent_categories;
create trigger agent_categories_limit
  before insert on public.agent_categories
  for each row execute function public.agent_categories_enforce_limit();

-- Atomically delete a user-owned category and null out agents that reference
-- its slug, in a single transaction. Returns the number of agents cleared.
create or replace function public.delete_agent_category_cascade(
  p_user_id uuid,
  p_category_id uuid
)
returns table (deleted boolean, cleared_agents int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_cleared int := 0;
begin
  select slug into v_slug
  from public.agent_categories
  where id = p_category_id and user_id = p_user_id
  for update;

  if not found then
    return query select false, 0;
    return;
  end if;

  with cleared as (
    update public.agents
    set category = null
    where user_id = p_user_id and category = v_slug
    returning 1
  )
  select count(*)::int into v_cleared from cleared;

  delete from public.agent_categories
  where id = p_category_id and user_id = p_user_id;

  return query select true, v_cleared;
end;
$$;

revoke all on function public.delete_agent_category_cascade(uuid, uuid) from public;
