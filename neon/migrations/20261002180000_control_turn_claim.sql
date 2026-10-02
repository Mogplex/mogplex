-- Enforce one live Control turn per conversation for both new and retained
-- app/worker releases. Existing live duplicates are preserved, not cancelled.
-- The trigger fences new admissions until those old writers finish or reap.
-- The partial unique index arbitrates concurrent inserts at the SQL boundary.
alter table public.ai_calls add column if not exists control_turn_guarded boolean not null default false;

create unique index if not exists control_conversation_active_turn
  on public.ai_calls(user_id, conversation_id)
  where control_turn_guarded and conversation_id is not null
    and metadata->>'surface' = 'control' and status in ('pending', 'streaming');

create or replace function public.guard_control_conversation_turn()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.conversation_id is null or new.metadata->>'surface' is distinct from 'control'
    or new.status not in ('pending', 'streaming') then return new; end if;
  -- Retained workers may continue updating already-active legacy rows. They
  -- remain outside the index and still fence new admissions until terminal.
  if TG_OP = 'UPDATE' then
    if not old.control_turn_guarded and old.status in ('pending', 'streaming')
      and old.metadata->>'surface' = 'control'
      and old.user_id = new.user_id and old.conversation_id = new.conversation_id then
      new.control_turn_guarded := false;
      return new;
    end if;
  end if;
  -- Never trust a client-supplied false flag to bypass the uniqueness guard.
  new.control_turn_guarded := true;
  if exists (select 1 from public.ai_calls c
    where c.user_id = new.user_id and c.conversation_id = new.conversation_id
      and c.id <> new.id and not c.control_turn_guarded
      and c.metadata->>'surface' = 'control' and c.status in ('pending', 'streaming')) then
    raise exception using errcode = '23505', constraint = 'control_conversation_active_turn',
      message = 'A turn is already running on this conversation.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_control_conversation_turn() from public;
grant execute on function public.guard_control_conversation_turn() to service_role;
drop trigger if exists guard_control_conversation_turn on public.ai_calls;
create trigger guard_control_conversation_turn before insert or update on public.ai_calls
  for each row execute function public.guard_control_conversation_turn();
