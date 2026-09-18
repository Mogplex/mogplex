import type { LanguageModel } from "ai";
import { loadLatestCompaction } from "@/lib/agents/compaction/store";
import {
  buildTurnPromotionEvidence,
  defaultPromotionGenerator,
  promoteMemoriesFromEvidence,
  type PromotionDeps,
  type PromotionResult,
} from "./memory-promotion";

export type PromotionTurnRecord = Parameters<
  typeof buildTurnPromotionEvidence
>[0];

/**
 * Production entry point for memory promotion: fires at task completion
 * (control chat onFinish). Prefers the conversation's compaction checkpoint
 * as the evidence record; without one, falls back to the finished turn itself
 * when it is substantive enough. Best-effort by contract — callers invoke it
 * fire-and-forget and a failure must never affect the finished run.
 */
export async function promoteMemoriesForConversation(input: {
  userId: string;
  conversationId: string | null;
  repoId?: string | null;
  aiCallId: string;
  model: LanguageModel;
  turn?: PromotionTurnRecord;
}): Promise<PromotionResult | null> {
  if (!input.conversationId) return null;

  const stored = await loadLatestCompaction({
    userId: input.userId,
    conversationId: input.conversationId,
  });
  const source = stored
    ? {
        evidenceText: JSON.stringify(
          (({ provenance: _p, ...body }) => body)(stored.checkpoint)
        ),
        source: {
          kind: "checkpoint" as const,
          id: stored.checkpoint.provenance.id,
        },
      }
    : (() => {
        const evidenceText = input.turn
          ? buildTurnPromotionEvidence(input.turn)
          : null;
        return evidenceText
          ? {
              evidenceText,
              source: { kind: "turn" as const, id: input.aiCallId },
            }
          : null;
      })();
  if (!source) return null;

  // Same lazy-import convention as lib/agents/tools/memory.ts: the memories
  // client allocates an embedder closure per creation, so load it only on the
  // (rare) runs that reach promotion.
  const mod = await import("@/lib/memories-client");
  const client = mod.createMemoriesClient(input.userId);
  const scope = input.repoId ? { repoId: input.repoId } : undefined;

  const deps: PromotionDeps = {
    generate: defaultPromotionGenerator,
    searchMemories: async ({ query, lane }) =>
      mod.searchMemories(client, query, lane, 5, scope),
    addMemory: async ({ lane, content, metadata }) => {
      await mod.addToLane(
        client,
        lane,
        content,
        mod.buildLaneScopedMetadata(lane, metadata, {
          repoId: input.repoId ?? null,
          workspaceSessionId: null,
          conversationId: input.conversationId,
          sandboxId: null,
        })
      );
    },
  };

  const result = await promoteMemoriesFromEvidence(
    { ...source, aiCallId: input.aiCallId, model: input.model },
    deps
  );

  if (result.promoted.length > 0 || result.rejected.length > 0) {
    console.info("[memory-promotion] run complete", {
      conversationId: input.conversationId,
      sourceKind: source.source.kind,
      promoted: result.promoted.length,
      duplicates: result.duplicates.length,
      rejected: result.rejected.map((r) => r.reason),
    });
  }
  return result;
}
