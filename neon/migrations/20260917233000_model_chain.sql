-- One transaction commits the chain while preserving existing destinations.
create or replace function public.save_model_chain(
  p_user_id uuid, p_primary text, p_fallbacks text[], p_previous_resolved text
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_previous text;
begin
  select default_model into strict v_previous from public.profiles where id = p_user_id for update;
  if p_fallbacks is null or cardinality(p_fallbacks) > 4 or p_primary = any(p_fallbacks) then
    raise exception 'Invalid model chain' using errcode = '22023';
  end if;
  perform public.apply_model_defaults(p_user_id, p_primary, v_previous, p_previous_resolved, array[]::text[], array[]::uuid[], null);
  update public.profiles set fallback_model_ids = p_fallbacks where id = p_user_id;
end;
$$;
revoke all on function public.save_model_chain(uuid,text,text[],text) from public;
grant execute on function public.save_model_chain(uuid,text,text[],text) to service_role;
