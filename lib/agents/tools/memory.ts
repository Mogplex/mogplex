import { z } from "zod";
import type { Tool } from "ai";
import { defineTool } from "./shared";

export type MemoryToolContext = {
  workspaceSessionId?: string | null;
  conversationId?: string | null;
  sandboxId?: string | null;
};

const MEMORY_LANES = ["session", "semantic", "episodic", "procedural"] as const;

const MAX_MEMORY_METADATA_BYTES = 4096;

const addMemoryParams = z.object({
  lane: z
    .enum(MEMORY_LANES)
    .describe(
      "session=per-conversation log (append-only), semantic=stable facts about the user/project, episodic=specific past events, procedural=how-to patterns the user has accepted"
    ),
  content: z
    .string()
    .min(1)
    .max(16_000)
    .describe("The memory content to save. Keep concise and self-contained."),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .refine(
      (value) =>
        value === undefined ||
        JSON.stringify(value).length <= MAX_MEMORY_METADATA_BYTES,
      {
        message: `metadata must be under ${MAX_MEMORY_METADATA_BYTES} bytes when JSON-serialised`,
      }
    )
    .describe(
      `Optional small JSON object of tags (<${MAX_MEMORY_METADATA_BYTES}B when serialised).`
    ),
});

const searchMemoriesParams = z.object({
  query: z.string().min(1).describe("Natural-language search query"),
  lane: z
    .enum(MEMORY_LANES)
    .optional()
    .describe("Restrict to one lane; omit to search across all lanes"),
  limit: z.number().int().min(1).max(50).default(10),
});

const listMemoriesParams = z.object({
  lane: z.enum(MEMORY_LANES).describe("Which lane to list"),
  limit: z.number().int().min(1).max(100).default(20),
});

function summariseMemory(memory: {
  id: string;
  lane: string;
  content: string;
  created_at: string;
}) {
  return {
    id: memory.id,
    lane: memory.lane,
    created_at: memory.created_at,
    content:
      memory.content.length > 2000
        ? `${memory.content.slice(0, 2000)}…`
        : memory.content,
  };
}

/**
 * Memory tools mirror the widget's semantics: session lane is append-only
 * (read + write, never edit/forget — it's a log the agent and user both
 * append to), and all lanes are scoped to the signed-in user. Edit/forget
 * stay deliberately out of the agent surface; users prune from the widget.
 */
export function createMemoryTools(
  userId: string,
  repoId: string | undefined,
  context: MemoryToolContext
): Record<string, Tool> {
  const baseScope = {
    repoId: repoId ?? null,
    workspaceSessionId: context.workspaceSessionId ?? null,
    conversationId: context.conversationId ?? null,
    sandboxId: context.sandboxId ?? null,
  };

  // Memoise the dynamic import + client. `import()` is already module-cached,
  // but `createMemoriesClient` allocates a fresh embedder closure per call and
  // the embedder caches the resolved gateway-key promise internally — so
  // reusing one client across all three tools in a conversation avoids paying
  // for `resolveGatewayKey` more than once per turn.
  let clientPromise: Promise<{
    mod: typeof import("@/lib/memories-client");
    client: ReturnType<
      typeof import("@/lib/memories-client").createMemoriesClient
    >;
  }> | null = null;
  const loadClient = () => {
    clientPromise ??= (async () => {
      const mod = await import("@/lib/memories-client");
      return { mod, client: mod.createMemoriesClient(userId) };
    })();
    return clientPromise;
  };

  const add_memory = defineTool({
    description:
      "Save a durable memory for this user. Session lane is append-only (no edit/delete). Use this to record user preferences, decisions, and session notes so future conversations have context.",
    inputSchema: addMemoryParams,
    execute: async ({
      lane,
      content,
      metadata,
    }: z.infer<typeof addMemoryParams>) => {
      try {
        const { mod, client } = await loadClient();
        const scopedMetadata = mod.buildLaneScopedMetadata(
          lane,
          metadata,
          baseScope
        );
        const memory = await mod.addToLane(
          client,
          lane,
          content,
          scopedMetadata
        );
        return {
          ok: true,
          memory: summariseMemory(memory),
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "add_memory failed",
        };
      }
    },
  });

  const search_memories = defineTool({
    description:
      "Search the user's saved memories across all lanes (or one lane). Returns up to `limit` matches ranked by semantic similarity, with a lexical fallback.",
    inputSchema: searchMemoriesParams,
    execute: async ({
      query,
      lane,
      limit,
    }: z.infer<typeof searchMemoriesParams>) => {
      try {
        const { mod, client } = await loadClient();
        // When no lane is supplied we're doing a cross-lane search. Passing
        // the full baseScope would narrow results to rows that were written
        // with `workspace_session_id` / `conversation_id` tags — which only
        // happens on session/episodic lanes. For cross-lane search we only
        // want to stay within the active repo, so restrict to repoId.
        const scope = lane
          ? mod.getMemoryScopeForLane(lane, baseScope)
          : baseScope.repoId
            ? { repoId: baseScope.repoId }
            : undefined;
        const results = await mod.searchMemories(
          client,
          query,
          lane,
          limit,
          scope
        );
        return {
          ok: true,
          count: results.length,
          memories: results.map(summariseMemory),
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : "search_memories failed",
        };
      }
    },
  });

  const list_memories = defineTool({
    description:
      "List the most recent memories in a lane (session/semantic/episodic/procedural), newest first. Use this to review what's already remembered before adding duplicates.",
    inputSchema: listMemoriesParams,
    execute: async ({ lane, limit }: z.infer<typeof listMemoriesParams>) => {
      try {
        const { mod, client } = await loadClient();
        const scope = mod.getMemoryScopeForLane(lane, baseScope);
        const results = await mod.listByLane(client, lane, limit, scope);
        return {
          ok: true,
          count: results.length,
          memories: results.map(summariseMemory),
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : "list_memories failed",
        };
      }
    },
  });

  return { add_memory, search_memories, list_memories };
}
