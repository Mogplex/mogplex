-- Native memories storage replacing @memories.sh/core SDK.
-- Tenant isolation is enforced at the DB via RLS (defense-in-depth) and
-- by explicit user_id filtering in application code (primary guard when
-- service-role is used).

create extension if not exists vector;

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lane text not null check (lane in ('session', 'semantic', 'episodic', 'procedural')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memories_user_lane_idx
  on public.memories (user_id, lane, created_at desc);

create index memories_embedding_idx
  on public.memories
  using hnsw (embedding vector_cosine_ops);

alter table public.memories enable row level security;

create policy memories_select_own on public.memories
  for select
  using (user_id = public.current_profile_id());

create policy memories_insert_own on public.memories
  for insert
  with check (user_id = public.current_profile_id());

create policy memories_update_own on public.memories
  for update
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

create policy memories_delete_own on public.memories
  for delete
  using (user_id = public.current_profile_id());

-- Vector similarity search. `security invoker` keeps RLS active when
-- called by an anon/authenticated client. The explicit match_user_id
-- filter is the primary guard when the service-role key is used.
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
