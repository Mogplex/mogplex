-- Guardrails on public.memories and the match_memories RPC.
-- 1. Cap content size to prevent oversized rows / ILIKE scans on abuse.
-- 2. Cap match_memories match_count to prevent full-index scans from
--    an authenticated client calling supabase.rpc('match_memories', ...).

alter table public.memories
  add constraint memories_content_length_check
  check (length(content) <= 16000);

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
  limit least(coalesce(match_count, 20), 100);
$$;
