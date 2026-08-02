-- Defense-in-depth for `updated_at`: application code in editMemory sets the
-- column explicitly, but a BEFORE UPDATE trigger guarantees freshness for any
-- direct DB update (admin console, future migrations, other code paths).

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

do $$
begin
  if to_regclass('public.memories') is null then
    return;
  end if;

  execute 'drop trigger if exists memories_set_updated_at on public.memories';
  execute $sql$
    create trigger memories_set_updated_at
      before update on public.memories
      for each row
      execute function public.memories_set_updated_at()
  $sql$;
end;
$$;
