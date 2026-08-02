-- Pin match_memories search_path to satisfy the Supabase security advisor
-- (function_search_path_mutable). Prevents hijack via role-scoped search_path.

create or replace function public.match_memories(
  query_embedding vector(1536),
  match_user_id uuid,
  match_lane text default null,
  match_count int default 20
)
returns table (
  id uuid,
  lane text,
  content text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    m.id,
    m.lane,
    m.content,
    m.metadata,
    m.created_at,
    m.updated_at,
    (1 - (m.embedding <=> query_embedding))::double precision as similarity
  from public.memories m
  where m.user_id = match_user_id
    and (match_lane is null or m.lane = match_lane)
    and m.embedding is not null
  order by m.embedding <=> query_embedding
  limit match_count;
$$;
