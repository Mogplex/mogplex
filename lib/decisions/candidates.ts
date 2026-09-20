import { decide, type DecisionHandle } from "./decide";
import { candidateKey, CANDIDATE_LIMIT } from "./definitions-selection";
import type { DecisionState } from "./state";
import type { DecisionId, DecisionScope } from "./types";

export type CandidateDecideFn = (
  id: DecisionId,
  state: DecisionState,
  scope: DecisionScope,
  options?: {
    baseline?: unknown;
    metadata?: Record<string, unknown>;
    candidates?: readonly string[];
  }
) => Promise<Pick<DecisionHandle, "status" | "verdict">>;

export const defaultCandidateDecide: CandidateDecideFn = decide;

/**
 * Give each candidate a short key for the model to answer under. Anything
 * past the limit is left out of the call and counted, never silently judged.
 */
export function labelCandidates<T>(items: readonly T[]): {
  labelled: Array<{ key: string; item: T }>;
  omitted: number;
} {
  const judged = items.slice(0, CANDIDATE_LIMIT);
  return {
    labelled: judged.map((item, index) => ({ key: candidateKey(index), item })),
    omitted: items.length - judged.length,
  };
}

/**
 * Run an observing check that must never affect the work beside it: a
 * rejection is logged and swallowed, so callers may start it and await it
 * later without a catch.
 */
export async function observeQuietly(
  label: string,
  work: () => Promise<unknown>
): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.warn(`[decisions] ${label} failed`, { error });
  }
}
