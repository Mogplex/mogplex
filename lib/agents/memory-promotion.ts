import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { AgentCheckpoint } from "@/lib/agents/compaction";
import { sanitizeTelemetryValue } from "@/lib/ai-telemetry";

/**
 * Memory promotion — compaction plan Phase 4.
 *
 * Compaction asks "what must survive for THIS task to continue?"; memory asks
 * "what should influence FUTURE tasks?". This module runs at task completion
 * and promotes only facts that are reusable, stable, scoped, and traceable to
 * checkpoint evidence. Raw checkpoint/handoff text is never stored — only
 * extracted candidates that pass every deterministic filter below. Session
 * and episodic lanes never receive promotions; they belong to the run.
 */

export const PROMOTION_MIN_CONFIDENCE = 0.7;
export const PROMOTION_MIN_CHARS = 20;
export const PROMOTION_MAX_CHARS = 2_000;
/** Cap writes per run: promotion is a distillation, not a transcript dump. */
export const PROMOTION_MAX_PER_RUN = 5;
/** Significant-word overlap ratio at which two memories count as duplicates. */
export const PROMOTION_DUPLICATE_OVERLAP = 0.6;

export const promotionCandidateSchema = z.object({
  content: z
    .string()
    .describe(
      "The fact to remember, self-contained and phrased for future tasks"
    ),
  lane: z
    .enum(["semantic", "procedural"])
    .describe(
      "semantic = stable fact about the user/project; procedural = how-to pattern the user accepted"
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How certain the fact is stable and reusable"),
  reasoning: z.string().describe("Why this belongs in durable memory"),
  evidence: z
    .array(z.string())
    .describe(
      "Verbatim fragments from the checkpoint that back this fact; at least one required"
    ),
});

export const promotionExtractionSchema = z.object({
  candidates: z.array(promotionCandidateSchema),
});

export type PromotionCandidate = z.infer<typeof promotionCandidateSchema>;
export type PromotionExtraction = z.infer<typeof promotionExtractionSchema>;

export type PromotionProvenance = {
  source: "promotion";
  sourceAiCallId: string;
  sourceCheckpointId: string;
  promotedAt: string;
  confidence: number;
  evidenceRefs: string[];
};

export type PromotionGenerator = (input: {
  model: LanguageModel;
  prompt: string;
}) => Promise<PromotionExtraction>;

const PROMOTION_SYSTEM_PROMPT = [
  "You extract durable memories from an agent task checkpoint.",
  "Promote ONLY facts that are: reusable beyond this task, stable over time,",
  "scoped to the user/project/repo, and backed by checkpoint evidence.",
  "Never promote: run-specific details (ports, transient errors, in-flight",
  "work), secrets or credentials, facts derivable from the repository itself,",
  "or restatements of what the task happened to do. Prefer zero candidates",
  "over weak ones.",
].join(" ");

export const defaultPromotionGenerator: PromotionGenerator = async (input) => {
  const { object } = await generateObject({
    model: input.model,
    schema: promotionExtractionSchema,
    system: PROMOTION_SYSTEM_PROMPT,
    prompt: input.prompt,
  });
  return object;
};

/** The checkpoint text evidence fragments must trace back to. */
export function serializeCheckpointForPromotion(
  checkpoint: AgentCheckpoint
): string {
  const { provenance: _provenance, ...body } = checkpoint;
  return JSON.stringify(body);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function significantWords(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9_./-]+/)
    .filter((word) => word.length > 3);
}

/**
 * True when enough of `candidate`'s significant words appear in `existing` —
 * the same fuzzy-overlap convention the checkpoint validator uses for tracing
 * requests back to user messages.
 */
export function isDuplicateContent(
  candidate: string,
  existing: string
): boolean {
  const words = significantWords(candidate);
  if (words.length === 0) return false;
  const existingWords = new Set(significantWords(existing));
  const hits = words.filter((word) => existingWords.has(word)).length;
  return hits / words.length >= PROMOTION_DUPLICATE_OVERLAP;
}

function containsSecretLikeContent(content: string): boolean {
  // The telemetry sanitizer rewrites anything secret-shaped; a candidate it
  // would alter has no business becoming durable memory.
  const sanitized = sanitizeTelemetryValue(content, {
    maxStringLength: content.length + 1,
  });
  return sanitized !== content;
}

export type PromotionRejection = {
  candidate: PromotionCandidate;
  reason:
    | "low_confidence"
    | "too_short"
    | "too_long"
    | "no_evidence"
    | "evidence_does_not_trace"
    | "secret_like_content"
    | "over_run_cap";
};

/**
 * Deterministic post-model gate. Fails closed: a candidate survives only if
 * every check passes, in declaration order, and at most PROMOTION_MAX_PER_RUN
 * survive (highest confidence first).
 */
export function filterPromotionCandidates(input: {
  candidates: PromotionCandidate[];
  checkpoint: AgentCheckpoint;
}): { accepted: PromotionCandidate[]; rejected: PromotionRejection[] } {
  const checkpointText = normalize(
    serializeCheckpointForPromotion(input.checkpoint)
  );
  const rejected: PromotionRejection[] = [];
  const passing: PromotionCandidate[] = [];

  for (const candidate of input.candidates) {
    const reject = (reason: PromotionRejection["reason"]) =>
      rejected.push({ candidate, reason });

    if (candidate.confidence < PROMOTION_MIN_CONFIDENCE) {
      reject("low_confidence");
      continue;
    }
    if (candidate.content.trim().length < PROMOTION_MIN_CHARS) {
      reject("too_short");
      continue;
    }
    if (candidate.content.length > PROMOTION_MAX_CHARS) {
      reject("too_long");
      continue;
    }
    if (candidate.evidence.length === 0) {
      reject("no_evidence");
      continue;
    }
    const traces = candidate.evidence.some(
      (fragment) =>
        fragment.trim().length > 0 &&
        checkpointText.includes(normalize(fragment))
    );
    if (!traces) {
      reject("evidence_does_not_trace");
      continue;
    }
    if (containsSecretLikeContent(candidate.content)) {
      reject("secret_like_content");
      continue;
    }
    passing.push(candidate);
  }

  const byConfidence = [...passing].sort((a, b) => b.confidence - a.confidence);
  const accepted = byConfidence.slice(0, PROMOTION_MAX_PER_RUN);
  for (const candidate of byConfidence.slice(PROMOTION_MAX_PER_RUN)) {
    rejected.push({ candidate, reason: "over_run_cap" });
  }
  return { accepted, rejected };
}

/** Boundary dependencies, injectable for tests (DI over mocking). */
export type PromotionDeps = {
  generate: PromotionGenerator;
  searchMemories: (input: {
    query: string;
    lane: "semantic" | "procedural";
  }) => Promise<Array<{ content: string }>>;
  addMemory: (input: {
    lane: "semantic" | "procedural";
    content: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  now?: () => Date;
};

export type PromotionResult = {
  promoted: PromotionCandidate[];
  rejected: PromotionRejection[];
  duplicates: PromotionCandidate[];
};

export async function promoteMemoriesFromCheckpoint(
  input: {
    checkpoint: AgentCheckpoint;
    aiCallId: string;
    model: LanguageModel;
  },
  deps: PromotionDeps
): Promise<PromotionResult> {
  const extraction = await deps.generate({
    model: input.model,
    prompt: serializeCheckpointForPromotion(input.checkpoint),
  });

  const { accepted, rejected } = filterPromotionCandidates({
    candidates: extraction.candidates,
    checkpoint: input.checkpoint,
  });

  const promoted: PromotionCandidate[] = [];
  const duplicates: PromotionCandidate[] = [];
  for (const candidate of accepted) {
    const existing = await deps.searchMemories({
      query: candidate.content,
      lane: candidate.lane,
    });
    if (
      existing.some((memory) =>
        isDuplicateContent(candidate.content, memory.content)
      )
    ) {
      duplicates.push(candidate);
      continue;
    }
    const provenance: PromotionProvenance = {
      source: "promotion",
      sourceAiCallId: input.aiCallId,
      sourceCheckpointId: input.checkpoint.provenance.id,
      promotedAt: (deps.now?.() ?? new Date()).toISOString(),
      confidence: candidate.confidence,
      evidenceRefs: candidate.evidence,
    };
    await deps.addMemory({
      lane: candidate.lane,
      content: candidate.content,
      metadata: { ...provenance },
    });
    promoted.push(candidate);
  }

  return { promoted, rejected, duplicates };
}
