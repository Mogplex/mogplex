import { createGateway, embed } from "ai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProviderKey } from "@/lib/vault";
import { MemoryNotFoundError } from "@/lib/memories-errors";
import {
  applyScopeFilters,
  compactMemoryScope,
  getMemoryScopeForLane,
  getRepoScopedSearchScope,
  memoryMatchesScope,
} from "@/lib/memories-scope";

// Re-export validation utilities for API compatibility
export {
  MAX_METADATA_BYTES,
  validateMetadata,
} from "@/lib/memories-validation";

export type MemoryLane = "session" | "semantic" | "episodic" | "procedural";
export type MemoryResourceScope = "personal" | "team";

const VALID_LANES = new Set<MemoryLane>([
  "session",
  "semantic",
  "episodic",
  "procedural",
]);

export type Memory = {
  id: string;
  lane: MemoryLane;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MemoryScope = {
  repoId?: string | null;
  workspaceSessionId?: string | null;
  conversationId?: string | null;
  resourceScope?: MemoryResourceScope | null;
  productTeamId?: string | null;
  sandboxId?: string | null;
  source?: string | null;
  agent?: string | null;
};

export const MAX_CONTENT_LENGTH = 16_000;
export const MAX_CHECKPOINT_LABEL_LENGTH = 512;
const EMBEDDING_MODEL_ID = "openai/text-embedding-3-small";
// Must stay in sync with the `vector(1536)` column in
// supabase/migrations/20260417121000_memories_table.sql. Changing the model
// requires a migration to alter the column dimension and rebuild the HNSW
// index.
const EMBEDDING_DIMS = 1536;
// Character-based cap on embedder input. text-embedding-3-small has an
// 8191-token limit; 8000 chars is safely under that for typical Latin-script
// input but can exceed it for CJK / dense text. The embedder treats a hard
// 400 from the gateway as a soft failure and returns null, so exceeding the
// token limit degrades to ILIKE search rather than throwing.
const EMBEDDING_INPUT_LIMIT = 8000;
const SESSION_VACUUM_DAYS = 30;

type AddMemoryOptions = {
  skipEmbedding?: boolean;
};

export function isValidLane(lane: unknown): lane is MemoryLane {
  return typeof lane === "string" && VALID_LANES.has(lane as MemoryLane);
}

type SupabaseLike = typeof supabaseAdmin;

export type Embedder = (value: string) => Promise<number[] | null>;

export type MemoriesModuleDeps = {
  supabase: SupabaseLike;
  embedder: Embedder;
};

export type MemoriesClient = MemoriesModuleDeps & {
  userId: string;
};

type SearchMemoriesOptions = {
  lane?: MemoryLane;
  limit?: number;
  scope?: MemoryScope;
  embedding?: Promise<number[] | null> | number[] | null;
  matches?: (memory: Memory) => boolean;
};

type MemoryRow = {
  id: string;
  lane: MemoryLane;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    lane: row.lane,
    content: row.content,
    metadata: row.metadata ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Escape LIKE/ILIKE metacharacters so user input is matched literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Resolve the gateway API key to use for a given user. Prefers the user's own
 * stored AI Gateway key (so they're billed for embeddings), then falls back to
 * the platform key. Returns null if neither is available, which triggers the
 * ILIKE-only search path.
 */
async function resolveGatewayKey(userId: string): Promise<string | null> {
  try {
    const userKey = await getProviderKey(userId, "ai_gateway");
    if (userKey) return userKey;
  } catch (err) {
    console.warn(
      "Failed to load user AI Gateway key, falling back to platform:",
      err instanceof Error ? err.message : err
    );
  }
  return process.env.AI_GATEWAY_API_KEY ?? null;
}

async function runGatewayEmbedding(
  apiKey: string,
  value: string
): Promise<number[] | null> {
  try {
    const gateway = createGateway({ apiKey });
    const { embedding } = await embed({
      model: gateway.embedding(EMBEDDING_MODEL_ID),
      value: value.slice(0, EMBEDDING_INPUT_LIMIT),
    });
    if (embedding.length !== EMBEDDING_DIMS) return null;
    return embedding;
  } catch (err) {
    console.warn(
      "Memory embedding failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Build an embedder bound to a specific user. The key is resolved once per
 * embedder instance and cached — the first call pays the lookup, subsequent
 * calls reuse it.
 */
export function createUserEmbedder(userId: string): Embedder {
  let keyPromise: Promise<string | null> | null = null;
  const getKey = () => (keyPromise ??= resolveGatewayKey(userId));
  return async (value: string) => {
    const apiKey = await getKey();
    if (!apiKey) return null;
    return runGatewayEmbedding(apiKey, value);
  };
}

export function createMemoriesClient(
  userId?: string,
  deps?: Partial<MemoriesModuleDeps>
): MemoriesClient {
  if (!userId) throw new Error("createMemoriesClient requires a userId");
  return {
    userId,
    supabase: deps?.supabase ?? supabaseAdmin,
    embedder: deps?.embedder ?? createUserEmbedder(userId),
  };
}

// Re-export scope utilities from dedicated module for API compatibility
export {
  applyScopeFilters,
  buildLaneScopedMetadata,
  compactMemoryScope,
  getMemoryScopeForLane,
  getRepoScopedSearchScope,
  memoryMatchesScope,
} from "@/lib/memories-scope";

export async function listByLane(
  client: MemoriesClient,
  lane: MemoryLane,
  limit = 50,
  scope?: MemoryScope
): Promise<Memory[]> {
  const query = applyScopeFilters(
    client.supabase
      .from("memories")
      .select("id, lane, content, metadata, created_at, updated_at")
      .eq("user_id", client.userId)
      .eq("lane", lane)
      .order("created_at", { ascending: false })
      .limit(limit),
    scope
  );
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as MemoryRow[]).map(rowToMemory);
}

export async function addToLane(
  client: MemoriesClient,
  lane: MemoryLane,
  content: string,
  metadata?: Record<string, unknown>,
  options?: AddMemoryOptions
): Promise<Memory> {
  const embedding = options?.skipEmbedding
    ? null
    : await client.embedder(content);
  const { data, error } = await client.supabase
    .from("memories")
    .insert({
      user_id: client.userId,
      lane,
      content,
      metadata: metadata ?? {},
      embedding,
    })
    .select("id, lane, content, metadata, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return rowToMemory(data as MemoryRow);
}

export async function searchMemories(
  client: MemoriesClient,
  query: string,
  lane?: MemoryLane,
  limit = 20,
  scope?: MemoryScope
): Promise<Memory[]> {
  return searchMemoriesInternal(client, query, {
    lane,
    limit,
    scope,
  });
}

async function searchMemoriesInternal(
  client: MemoriesClient,
  query: string,
  options: SearchMemoriesOptions = {}
): Promise<Memory[]> {
  const limit = options.limit ?? 20;
  const embedding =
    options.embedding === undefined
      ? await client.embedder(query)
      : await options.embedding;
  const hits: Memory[] = [];
  const seen = new Set<string>();
  const normalizedScope = compactMemoryScope(options.scope);
  const vectorMatchCount = options.matches ? Math.max(limit * 3, limit) : limit;

  if (embedding) {
    const { data, error } = await client.supabase.rpc("match_memories", {
      query_embedding: embedding,
      match_user_id: client.userId,
      match_lane: options.lane ?? null,
      match_count: vectorMatchCount,
    });
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as MemoryRow[]) {
      const memory = rowToMemory(row);
      if (!memoryMatchesScope(memory, normalizedScope)) continue;
      if (options.matches && !options.matches(memory)) continue;
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      hits.push(memory);
      if (hits.length >= limit) break;
    }
  }

  // Always run a lexical pass so rows created while embeddings were
  // unavailable remain discoverable. Escape LIKE metacharacters.
  //
  // Note: when vector search ran we restrict the lexical pass to non-embedded
  // rows (`.is('embedding', null)`) to avoid duplicating work. As a result the
  // returned set may be smaller than `limit` even when more matching embedded
  // rows exist — this is intentional, since vector results are already the
  // best embedded matches and topping up with lower-quality ILIKE matches of
  // the same rows would not improve relevance.
  if (hits.length >= limit) return hits.slice(0, limit);
  const pattern = `%${escapeLikePattern(query)}%`;
  const lexicalCandidateLimit = options.matches ? limit * 5 : limit * 3;
  const lexicalLimit = normalizedScope
    ? Math.min(lexicalCandidateLimit, 100)
    : lexicalCandidateLimit;
  let q = applyScopeFilters(
    client.supabase
      .from("memories")
      .select("id, lane, content, metadata, created_at, updated_at")
      .eq("user_id", client.userId)
      .ilike("content", pattern)
      .order("created_at", { ascending: false })
      .limit(lexicalLimit),
    normalizedScope
  );
  if (embedding) q = q.is("embedding", null);
  if (options.lane) q = q.eq("lane", options.lane);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as MemoryRow[]) {
    const memory = rowToMemory(row);
    if (!memoryMatchesScope(memory, normalizedScope)) continue;
    if (options.matches && !options.matches(memory)) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    hits.push(memory);
    if (hits.length >= limit) break;
  }
  return hits;
}

export async function editMemory(
  client: MemoriesClient,
  id: string,
  content: string
): Promise<void> {
  const embedding = await client.embedder(content);
  const update: Record<string, unknown> = {
    content,
    updated_at: new Date().toISOString(),
  };
  // Preserve the prior embedding on transient embedder failures. A stale
  // embedding is better than silently dropping the row out of vector search.
  if (embedding) {
    update.embedding = embedding;
  } else {
    console.warn(
      `editMemory: skipping embedding update for ${id} — embedder returned null`
    );
  }
  const { data, error } = await client.supabase
    .from("memories")
    .update(update)
    .eq("id", id)
    .eq("user_id", client.userId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new MemoryNotFoundError(id);
}

export async function forgetMemory(
  client: MemoriesClient,
  id: string
): Promise<void> {
  const { data, error } = await client.supabase
    .from("memories")
    .delete()
    .eq("id", id)
    .eq("user_id", client.userId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new MemoryNotFoundError(id);
}

/**
 * Compact session memories older than SESSION_VACUUM_DAYS. Longer-term lanes
 * are retained — users prune those explicitly.
 */
export async function vacuum(
  client: MemoriesClient,
  now: Date = new Date()
): Promise<void> {
  const cutoff = new Date(
    now.getTime() - SESSION_VACUUM_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { error } = await client.supabase
    .from("memories")
    .delete()
    .eq("user_id", client.userId)
    .eq("lane", "session")
    .lt("created_at", cutoff);
  if (error) throw new Error(error.message);
}

/**
 * Recency + vector hybrid for chat context injection. Returns the shape the
 * chat route expects: { memories: [{ content }] }.
 *
 * Design note: gates the embedder + search on a cheap existence check so
 * users with zero memories don't pay for an OpenAI embeddings call on every
 * chat message. When at least one row exists, both queries run in parallel
 * (`Promise.all`) so the added latency is one Supabase round-trip, not two.
 * The chat route's timeout race caps the total cost.
 */
export async function loadMemoryContextNative(
  userId: string,
  query: string,
  limit = 10,
  deps?: Partial<MemoriesModuleDeps>,
  scope?: MemoryScope
): Promise<{ memories: Array<{ content: string }> } | null> {
  const client = createMemoriesClient(userId, deps);
  const repoScope = getRepoScopedSearchScope(scope);
  const sessionScope = getMemoryScopeForLane("session", scope);

  // Cheap existence check — uses the (user_id, lane, created_at) index and
  // returns at most one row. Avoids paying for an embeddings API call when
  // the user has no memories at all.
  const existenceQuery = applyScopeFilters(
    client.supabase
      .from("memories")
      .select("id")
      .eq("user_id", client.userId)
      .limit(1),
    repoScope
  );
  const { data: existence, error: existenceError } = await existenceQuery;
  if (existenceError) throw new Error(existenceError.message);
  if (!existence || existence.length === 0) return null;

  const searchEmbedding = client.embedder(query);
  const [recentSession, searchHits] = await Promise.all([
    listByLane(client, "session", 5, sessionScope),
    searchMemoriesInternal(client, query, {
      limit,
      scope: repoScope,
      embedding: searchEmbedding,
      matches(memory) {
        return (
          memory.lane !== "session" || memoryMatchesScope(memory, sessionScope)
        );
      },
    }),
  ]);

  const seen = new Set<string>();
  const merged: Array<{ content: string }> = [];
  for (const row of [...recentSession, ...searchHits]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push({ content: row.content });
    if (merged.length >= limit) break;
  }

  if (merged.length === 0) return null;
  return { memories: merged };
}

export {
  InvalidMetadataError,
  MemoryNotFoundError,
} from "@/lib/memories-errors";
