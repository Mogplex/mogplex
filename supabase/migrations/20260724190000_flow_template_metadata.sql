alter table public.flow_templates
  add column if not exists trigger_event text,
  add column if not exists reconnect text[],
  add column if not exists requires_repository boolean;

with template_nodes as (
  select
    template.id,
    node.value
  from public.flow_templates as template
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(template.graph -> 'nodes') = 'array'
        then template.graph -> 'nodes'
      else '[]'::jsonb
    end
  ) as node(value)
),
template_metadata as (
  select
    template.id,
    coalesce(
      (
        select node.value -> 'data' ->> 'event'
        from template_nodes as node
        where node.id = template.id
          and node.value ->> 'type' = 'start'
        limit 1
      ),
      'mention'
    ) as trigger_event,
    array_remove(
      array[
        case
          when exists (
            select 1
            from template_nodes as node
            where node.id = template.id
              and node.value ->> 'type' = 'start'
              and node.value -> 'data' ->> 'event' = 'webhook'
          )
            then 'webhook'
        end,
        case
          when exists (
            select 1
            from template_nodes as node
            where node.id = template.id
              and (
                (
                  node.value ->> 'type' = 'start'
                  and node.value -> 'data' ->> 'event' = 'slack_mention'
                )
                or (
                  node.value ->> 'type' = 'action'
                  and node.value -> 'data' ->> 'operation' = 'slack.send_message'
                )
              )
          )
            then 'slack'
        end
      ]::text[],
      null
    ) as reconnect,
    exists (
      select 1
      from template_nodes as node
      where node.id = template.id
        and node.value ->> 'type' = 'start'
        and node.value -> 'data' ->> 'event'
          in ('schedule', 'webhook', 'slack_mention')
    ) as requires_repository
  from public.flow_templates as template
)
update public.flow_templates as template
set
  trigger_event = coalesce(template.trigger_event, metadata.trigger_event),
  reconnect = coalesce(template.reconnect, metadata.reconnect),
  requires_repository = coalesce(
    template.requires_repository,
    metadata.requires_repository
  )
from template_metadata as metadata
where template.id = metadata.id
  and (
    template.trigger_event is null
    or template.reconnect is null
    or template.requires_repository is null
  );

alter table public.flow_templates
  alter column reconnect set default '{}',
  alter column requires_repository set default false,
  alter column trigger_event set not null,
  alter column reconnect set not null,
  alter column requires_repository set not null;
