-- Preserve independent surface defaults when an account default changes.
alter table public.profiles add column if not exists surface_models jsonb not null default '{}'::jsonb;

create or replace function public.apply_model_defaults(
  p_user_id uuid,
  p_next_model text,
  p_expected_model text,
  p_previous_resolved text,
  p_surfaces text[],
  p_flow_ids uuid[],
  p_theme text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_surface text;
  v_models jsonb;
  v_flow public.flows%rowtype;
  v_graph jsonb;
  v_published jsonb;
  v_version_id uuid;
  v_version_number integer;
  v_selected integer := 0;
  v_drafts integer := 0;
  v_versions integer := 0;
begin
  select * into strict v_profile from public.profiles where id = p_user_id for update;
  if v_profile.default_model is distinct from p_expected_model then
    raise exception 'Default model changed; reload settings and try again' using errcode = '40001';
  end if;
  if p_next_model is null or btrim(p_next_model) = '' or
     not p_surfaces <@ array['chat','slack','cli','control','agents']::text[] then
    raise exception 'Invalid model settings' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_flow_ids) as selected(flow_id) where not exists (
    select 1 from public.flows f where f.id = selected.flow_id and f.user_id = p_user_id
  )) then
    raise exception 'Automation is unavailable' using errcode = '42501';
  end if;
  v_models := v_profile.surface_models;
  foreach v_surface in array array['chat','slack','cli','control','agents'] loop
    v_models := jsonb_set(v_models, array[v_surface], to_jsonb(case
      when v_surface = any(p_surfaces) then p_next_model
      else coalesce(nullif(v_models ->> v_surface, ''), v_profile.default_model, p_previous_resolved)
    end));
  end loop;
  update public.profiles set default_model = p_next_model, surface_models = v_models,
    theme = coalesce(p_theme, theme) where id = p_user_id;

  -- Lock in a stable order. Draft and published graphs are rewritten separately:
  -- selecting a model must never publish unrelated draft edits.
  for v_flow in select * from public.flows where user_id = p_user_id and id = any(p_flow_ids) order by id for update loop
    v_selected := v_selected + 1;
    select jsonb_set(v_flow.draft_graph, '{nodes}', coalesce(jsonb_agg(case
      when n ->> 'type' = 'agent' then jsonb_set(n, '{data,modelOverride}', to_jsonb(p_next_model)) else n end order by ord), '[]'))
      into v_graph from jsonb_array_elements(v_flow.draft_graph -> 'nodes') with ordinality as nodes(n, ord);
    if v_graph is distinct from v_flow.draft_graph then
      update public.flows set draft_graph = v_graph where id = v_flow.id;
      v_drafts := v_drafts + 1;
    end if;
    if v_flow.published_version_id is not null then
      select graph into strict v_published from public.flow_versions where id = v_flow.published_version_id and flow_id = v_flow.id;
      select jsonb_set(v_published, '{nodes}', coalesce(jsonb_agg(case
        when n ->> 'type' = 'agent' then jsonb_set(n, '{data,modelOverride}', to_jsonb(p_next_model)) else n end order by ord), '[]'))
        into v_graph from jsonb_array_elements(v_published -> 'nodes') with ordinality as nodes(n, ord);
      if v_graph is distinct from v_published then
        select coalesce(max(version_number), 0) + 1 into v_version_number from public.flow_versions where flow_id = v_flow.id;
        insert into public.flow_versions (flow_id, version_number, graph) values (v_flow.id, v_version_number, v_graph) returning id into v_version_id;
        update public.flows set published_version_id = v_version_id where id = v_flow.id;
        v_versions := v_versions + 1;
      end if;
    end if;
  end loop;
  if v_selected <> (select count(distinct id) from unnest(p_flow_ids) as selected(id)) then
    raise exception 'Automation is unavailable' using errcode = '42501';
  end if;
  return jsonb_build_object('drafts_updated', v_drafts, 'versions_published', v_versions);
end;
$$;
revoke all on function public.apply_model_defaults(uuid,text,text,text,text[],uuid[],text) from public;
grant execute on function public.apply_model_defaults(uuid,text,text,text,text[],uuid[],text) to service_role;
