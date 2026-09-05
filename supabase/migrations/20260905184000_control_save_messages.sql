-- Serialize transcript changes by message identity, preserving concurrent turns.
-- Only the service role can replace a message, with its exact previous value.
create or replace function public.control_save_messages(
  p_user_id uuid,
  p_session_id uuid,
  p_messages jsonb,
  p_expected_messages jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  session_row public.control_sessions%rowtype;
  next_messages jsonb;
  incoming jsonb;
  existing jsonb;
  expected jsonb;
  message_position integer;
begin
  if jsonb_typeof(p_messages) is distinct from 'array'
     or jsonb_typeof(p_expected_messages) is distinct from 'array'
     or exists (
       select 1 from jsonb_array_elements(p_messages) m
       where jsonb_typeof(m->'id') is distinct from 'string'
          or btrim(m->>'id') = ''
          or coalesce(m->>'role', '') not in ('user', 'assistant', 'system')
          or jsonb_typeof(m->'parts') is distinct from 'array'
     ) or (select count(*) <> count(distinct m->>'id') from jsonb_array_elements(p_messages) m)
  then raise exception 'Invalid Control messages' using errcode = '22023'; end if;

  select * into session_row from public.control_sessions
    where id = p_session_id and user_id = p_user_id and archived = false
    for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  next_messages := session_row.messages;

  for incoming in select value from jsonb_array_elements(p_messages) loop
    existing := null;
    expected := null;
    select m.value, (m.ordinality - 1)::integer into existing, message_position
      from jsonb_array_elements(next_messages) with ordinality m
      where m.value->>'id' = incoming->>'id';
    select m into expected from jsonb_array_elements(p_expected_messages) m
      where m->>'id' = incoming->>'id';
    if existing is null then
      if expected is not null then return jsonb_build_object('status', 'conflict'); end if;
      next_messages := next_messages || jsonb_build_array(incoming);
    elsif existing = incoming then
      continue;
    elsif expected is not null then
      if existing <> expected then return jsonb_build_object('status', 'conflict'); end if;
      next_messages := jsonb_set(next_messages, array[message_position::text], incoming);
    end if;
    -- An older browser may append, but cannot overwrite a stored message.
  end loop;

  if next_messages is distinct from session_row.messages then
    update public.control_sessions set messages = next_messages, updated_at = clock_timestamp()
      where id = p_session_id and user_id = p_user_id
      returning * into session_row;
  end if;
  return jsonb_build_object('status', 'ok', 'session', to_jsonb(session_row));
end;
$$;

revoke all on function public.control_save_messages(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.control_save_messages(uuid, uuid, jsonb, jsonb) to service_role;
