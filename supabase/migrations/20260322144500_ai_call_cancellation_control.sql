alter table public.ai_calls
  add column if not exists cancel_requested_at timestamptz null;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_calls'
      and column_name = 'control_state'
  ) then
    alter table public.ai_calls
      add column control_state text not null default 'active';
  end if;
end $$;

update public.ai_calls
set control_state = case
  when status = 'cancelled' then 'cancelled'
  else 'active'
end
where control_state is distinct from case
  when status = 'cancelled' then 'cancelled'
  else 'active'
end;

alter table public.ai_calls
  drop constraint if exists ai_calls_control_state_check;

alter table public.ai_calls
  add constraint ai_calls_control_state_check
  check (control_state in ('active', 'cancel_requested', 'cancelled'));

create index if not exists idx_ai_calls_live_interactive
  on public.ai_calls (user_id, started_at desc)
  where type in ('chat', 'agent') and status in ('pending', 'streaming');
