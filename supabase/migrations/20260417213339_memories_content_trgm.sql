-- Trigram index on public.memories.content so the ILIKE fallback in
-- searchMemories can use index scans at scale instead of sequential scans
-- within a user's row set. Relevant when the embedder returns null (missing
-- AI Gateway key, transient outages, or pre-embedding rows supplemented by
-- the lexical pass).

create extension if not exists pg_trgm;

create index if not exists memories_content_trgm_idx
  on public.memories
  using gin (content gin_trgm_ops);
