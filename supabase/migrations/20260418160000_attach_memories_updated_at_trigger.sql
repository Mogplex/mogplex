-- The production-aligned memories table migration now runs after the original
-- trigger migration version. Re-attach the trigger here once public.memories is
-- guaranteed to exist so fresh databases keep the updated_at invariant.

create or replace function public.memories_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists memories_set_updated_at on public.memories;

create trigger memories_set_updated_at
  before update on public.memories
  for each row
  execute function public.memories_set_updated_at();
