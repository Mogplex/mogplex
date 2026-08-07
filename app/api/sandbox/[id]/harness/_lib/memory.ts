import type { MemoryScope } from "@/lib/memories-client";

/**
 * Builds a memory scope object for harness runs. Used to scope memory
 * retrieval and persistence to the relevant context (repo, sandbox,
 * conversation, workspace session).
 */
export function buildHarnessMemoryScope(input: {
  repoId: string | null;
  sandboxId: string;
  conversationId?: string;
  workspaceSessionId?: string | null;
}): MemoryScope | undefined {
  const scope: MemoryScope = {};
  if (input.repoId) scope.repoId = input.repoId;
  if (input.sandboxId) scope.sandboxId = input.sandboxId;
  if (input.conversationId) scope.conversationId = input.conversationId;
  if (input.workspaceSessionId) {
    scope.workspaceSessionId = input.workspaceSessionId;
  }
  return Object.keys(scope).length > 0 ? scope : undefined;
}

/**
 * Formats a list of memories into a Markdown section for injection
 * into the harness prompt.
 */
export function buildHarnessMemoryContextSection(
  context: {
    memories?: Array<{ content: string }>;
  } | null
): string | null {
  if (!context?.memories?.length) return null;
  return [
    "## Relevant Memories",
    ...context.memories.map((memory) => `- ${memory.content}`),
  ].join("\n");
}

/**
 * Wraps the prompt with memory context if available.
 */
export function appendHarnessMemoryContext(
  prompt: string,
  memorySection: string | null
): string {
  return memorySection
    ? `<memory-context>\n${memorySection}\n</memory-context>\n\n${prompt}`
    : prompt;
}

/**
 * Loads relevant memories for the given prompt and scope, then prepends
 * them to the prompt as a memory context section.
 */
export async function loadHarnessPromptWithMemoryContext(
  userId: string,
  prompt: string,
  scope?: MemoryScope
): Promise<string> {
  try {
    const { loadMemoryContextNative } = await import("@/lib/memories-client");
    const context = await loadMemoryContextNative(
      userId,
      prompt,
      10,
      undefined,
      scope
    );
    return appendHarnessMemoryContext(
      prompt,
      buildHarnessMemoryContextSection(context)
    );
  } catch (error) {
    console.warn("[harness] failed to load memory context", error);
    return prompt;
  }
}

/**
 * Persists a memory entry for the harness run. Used to record prompts
 * and outcomes for future memory retrieval.
 */
export async function persistHarnessMemory(input: {
  userId: string;
  lane: "session" | "episodic";
  content: string;
  metadata?: Record<string, unknown>;
  scope?: MemoryScope;
  source: string;
  agent: string;
}): Promise<void> {
  if (!input.content.trim()) return;

  try {
    const { addToLane, buildLaneScopedMetadata, createMemoriesClient } =
      await import("@/lib/memories-client");

    await addToLane(
      createMemoriesClient(input.userId),
      input.lane,
      input.content,
      buildLaneScopedMetadata(input.lane, input.metadata, {
        ...input.scope,
        source: input.source,
        agent: input.agent,
      }),
      { skipEmbedding: true }
    );
  } catch (error) {
    console.warn("[harness] failed to persist memory", error);
  }
}
