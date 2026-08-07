import type { LanguageModel } from "ai";
import {
  buildCheckpoint,
  collectVerbatimUserMessages,
  renderHandoff,
  type CheckpointGenerator,
} from "./checkpoint";
import {
  estimateMessagesChars,
  hashMessagePrefix,
  matchCheckpointPrefix,
  planCompactionSplit,
} from "./plan";
import type {
  AgentCheckpoint,
  CompactableAgentMessage,
  CompactionEventPayload,
} from "./types";
import { validateCheckpoint } from "./validate";

export * from "./types";
export * from "./plan";
export * from "./reduce";
export * from "./validate";
export {
  buildCheckpoint,
  collectVerbatimUserMessages,
  renderHandoff,
  serializeCoveredTranscript,
  generateCheckpointObject,
  HANDOFF_PREFIX,
  type CheckpointGenerator,
} from "./checkpoint";

/** A previously persisted checkpoint, as loaded from the audit store. */
export type StoredCompaction = {
  checkpoint: AgentCheckpoint;
  handoff: string;
  prefixHash: string;
  coveredMessageCount: number;
};

export type CompactConversationInput<Message extends CompactableAgentMessage> =
  {
    messages: readonly Message[];
    /** Resolved model instance used for the checkpoint-building call. */
    model: LanguageModel;
    compactorModelId: string;
    /** Latest persisted compaction for this conversation, if any. */
    previous?: StoredCompaction | null;
    /** Wrap the rendered handoff text in the surface's message shape. */
    buildHandoffMessage: (handoffText: string) => Message;
    generate?: CheckpointGenerator;
    charBudget?: number;
    keepRecent?: number;
    abortSignal?: AbortSignal;
  };

export type CompactConversationResult<Message extends CompactableAgentMessage> =
  | { outcome: "unchanged"; messages: Message[] }
  | {
      /** A persisted checkpoint was applied; no model call was needed. */
      outcome: "reused";
      messages: Message[];
      checkpointId: string;
    }
  | {
      outcome: "compacted";
      messages: Message[];
      checkpoint: AgentCheckpoint;
      event: CompactionEventPayload;
    }
  | {
      /**
       * A checkpoint was built but failed deterministic validation, or the
       * build itself failed. Callers choose their own degradation (the chat
       * route passes history through unchanged; the Slack runner windows).
       */
      outcome: "failed";
      messages: Message[];
      event: CompactionEventPayload | null;
      error: string;
    };

/**
 * Conversation-level compaction: reuse the last persisted checkpoint when the
 * covered prefix is intact, and build/validate a new one when the history has
 * outgrown the budget. Persistence of the returned event is the caller's job
 * (surfaces store audit rows differently).
 */
export async function compactConversation<
  Message extends CompactableAgentMessage,
>(
  input: CompactConversationInput<Message>
): Promise<CompactConversationResult<Message>> {
  let working = [...input.messages];
  let reusedCheckpointId: string | null = null;
  let parentCheckpointId: string | null = null;
  let reusedCoveredCount = 0;

  if (input.previous) {
    const match = matchCheckpointPrefix(working, input.previous);
    if (match) {
      working = [
        ...match.leadingSystem,
        input.buildHandoffMessage(input.previous.handoff),
        ...match.suffix,
      ];
      reusedCheckpointId = input.previous.checkpoint.provenance.id;
      parentCheckpointId = reusedCheckpointId;
      reusedCoveredCount = input.previous.coveredMessageCount;
    }
  }

  const split = planCompactionSplit(working, {
    charBudget: input.charBudget,
    keepRecent: input.keepRecent,
  });

  if (!split.compact) {
    if (reusedCheckpointId) {
      return {
        outcome: "reused",
        messages: working,
        checkpointId: reusedCheckpointId,
      };
    }
    return { outcome: "unchanged", messages: working };
  }

  const charsBefore = estimateMessagesChars(working);
  const startedAt = Date.now();

  let checkpoint: AgentCheckpoint;
  try {
    checkpoint = await buildCheckpoint({
      covered: split.covered,
      model: input.model,
      compactorModelId: input.compactorModelId,
      parentCheckpointId,
      generate: input.generate,
      abortSignal: input.abortSignal,
    });
  } catch (error) {
    return {
      outcome: "failed",
      messages: working,
      event: null,
      error: error instanceof Error ? error.message : "checkpoint build failed",
    };
  }

  const validation = validateCheckpoint({
    checkpoint,
    covered: split.covered,
    previousCheckpoint: input.previous?.checkpoint ?? null,
  });

  const handoff = renderHandoff(
    checkpoint,
    collectVerbatimUserMessages(split.covered)
  );
  const compacted = [
    ...split.leadingSystem,
    input.buildHandoffMessage(handoff),
    ...split.recent,
  ];

  // The stored fingerprint must describe the ORIGINAL history the surface
  // will present next turn. After a reuse, `split.covered` starts with the
  // injected handoff message, which the client never sends — so the covered
  // range is re-expressed in original-message terms: everything the previous
  // checkpoint covered plus the newly covered suffix messages.
  const systemCount = split.leadingSystem.length;
  const coveredOriginalCount = reusedCheckpointId
    ? reusedCoveredCount + (split.covered.length - 1)
    : split.covered.length;
  const originalCoveredSlice = input.messages.slice(
    systemCount,
    systemCount + coveredOriginalCount
  );

  const event: CompactionEventPayload = {
    kind: "compaction",
    checkpoint,
    handoff,
    prefixHash: hashMessagePrefix(originalCoveredSlice),
    coveredMessageCount: coveredOriginalCount,
    charsBefore,
    charsAfter: estimateMessagesChars(compacted),
    durationMs: Date.now() - startedAt,
    validation,
  };

  if (!validation.ok) {
    return {
      outcome: "failed",
      messages: working,
      event,
      error: `checkpoint validation failed: ${validation.failures.join(", ")}`,
    };
  }

  return { outcome: "compacted", messages: compacted, checkpoint, event };
}
