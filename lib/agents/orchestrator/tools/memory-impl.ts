import { z } from "zod";
import type { Tool } from "ai";
import { loadLatestCompaction } from "@/lib/agents/compaction/store";
import type { StoredCompaction } from "@/lib/agents/compaction";
import { defineTool } from "../helpers";
import type { OrchestratorToolContext } from "../types";

/**
 * Real implementations for the orchestrator's history/handoff memory tools.
 * Both are thin surfaces over existing infrastructure: the compaction store
 * (checkpoints are the authoritative history summary) and the memories
 * episodic lane (handoff notes are events, not stable facts).
 */

export type SummarizeHistoryDeps = {
  loadLatestCompaction: (input: {
    userId: string;
    conversationId: string;
  }) => Promise<StoredCompaction | null>;
};

const summarizeHistoryParams = z.object({});

const defaultSummarizeHistoryDeps: SummarizeHistoryDeps = {
  loadLatestCompaction,
};

export function createSummarizeHistoryTool(
  ctx: OrchestratorToolContext,
  deps: SummarizeHistoryDeps = defaultSummarizeHistoryDeps
): Tool {
  return defineTool({
    description:
      "Read this conversation's latest compaction checkpoint: task, progress, decisions, blockers, and next action. Returns nothing if the history has not been compacted yet.",
    inputSchema: summarizeHistoryParams,
    execute: async () => {
      if (!ctx.conversationId) {
        return {
          ok: false,
          note: "No conversation id in scope; history summaries need a persisted conversation.",
        };
      }
      const stored = await deps.loadLatestCompaction({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
      });
      if (!stored) {
        return {
          ok: false,
          note: "No checkpoint yet — the conversation has not grown past the compaction budget.",
        };
      }
      const { provenance, ...body } = stored.checkpoint;
      return {
        ok: true,
        checkpoint: body,
        checkpointId: provenance.id,
        createdAt: provenance.createdAt,
        coveredMessageCount: stored.coveredMessageCount,
      };
    },
  });
}

export type HandoffNoteDeps = {
  addEpisodicNote: (input: {
    userId: string;
    content: string;
    metadata: Record<string, unknown>;
    scope: {
      repoId: string | null;
      conversationId: string | null;
      sandboxId: string | null;
    };
  }) => Promise<void>;
};

async function defaultAddEpisodicNote(input: {
  userId: string;
  content: string;
  metadata: Record<string, unknown>;
  scope: {
    repoId: string | null;
    conversationId: string | null;
    sandboxId: string | null;
  };
}): Promise<void> {
  // Same lazy-import convention as tools/memory.ts.
  const mod = await import("@/lib/memories-client");
  const client = mod.createMemoriesClient(input.userId);
  await mod.addToLane(
    client,
    "episodic",
    input.content,
    mod.buildLaneScopedMetadata("episodic", input.metadata, {
      ...input.scope,
      workspaceSessionId: null,
    })
  );
}

const handoffNoteParams = z.object({
  note: z.string().min(1).max(4_000).describe("Handoff note content"),
  forAgent: z.string().optional().describe("Target agent, if any"),
});

const defaultHandoffNoteDeps: HandoffNoteDeps = {
  addEpisodicNote: defaultAddEpisodicNote,
};

export function createHandoffNoteTool(
  ctx: OrchestratorToolContext,
  deps: HandoffNoteDeps = defaultHandoffNoteDeps
): Tool {
  return defineTool({
    description:
      "Leave a note for the next agent or operator working in this conversation. Stored in episodic memory with provenance; retrieve with memory_search.",
    inputSchema: handoffNoteParams,
    execute: async ({ note, forAgent }: z.infer<typeof handoffNoteParams>) => {
      try {
        await deps.addEpisodicNote({
          userId: ctx.userId,
          content: note,
          metadata: {
            source: "handoff_note",
            forAgent: forAgent ?? null,
            missionId: ctx.missionId ?? null,
            aiCallId: ctx.aiCallId ?? null,
          },
          scope: {
            repoId: ctx.repoId ?? null,
            conversationId: ctx.conversationId ?? null,
            sandboxId: ctx.sandboxId ?? null,
          },
        });
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "handoff_note failed",
        };
      }
    },
  });
}
