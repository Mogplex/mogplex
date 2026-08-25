-- Let run-specific subscribers reject unrelated AI-call events without a
-- database lookup. Existing triggers pick up the replaced function body.
create or replace function public.mogplex_notify_table_event()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify(
    'mogplex_table_events',
    json_build_object(
      'table', TG_TABLE_NAME,
      'op', TG_OP,
      'user_id', coalesce(to_jsonb(NEW) ->> 'user_id', to_jsonb(OLD) ->> 'user_id'),
      'id', coalesce(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id'),
      'ai_call_id', coalesce(to_jsonb(NEW) ->> 'ai_call_id', to_jsonb(OLD) ->> 'ai_call_id')
    )::text
  );
  return coalesce(NEW, OLD);
end;
$$;
