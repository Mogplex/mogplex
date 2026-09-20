import type {
  DecisionAnswer,
  DecisionAnswers,
  DecisionDefinition,
} from "./types";

/**
 * Decisions that judge a list of candidates in one pass: which of an agent's
 * skills a request needs, and which of a turn's memories bear on it. Each
 * candidate gets its own yes/no question under a short key, so one call
 * returns a probability per candidate.
 *
 * Both observe only. Their thresholds are first guesses: no production data
 * exists yet, and the recorded probabilities are what will set them.
 */

export const CANDIDATE_KEY_PREFIX = "c";
/** One call judges at most this many candidates; the rest are not asked. */
export const CANDIDATE_LIMIT = 48;

export function candidateKey(index: number): string {
  return `${CANDIDATE_KEY_PREFIX}${String(index + 1).padStart(2, "0")}`;
}

function isCandidateKey(key: string): boolean {
  return /^c\d{2,}$/.test(key);
}

function probability(answer: DecisionAnswer | undefined): number {
  return answer?.type === "boolean" ? answer.probability : 0;
}

/** Candidate keys whose answer is at or above `threshold`. */
export function candidatesAtOrAbove(
  answers: DecisionAnswers,
  threshold: number
): string[] {
  return Object.keys(answers)
    .filter(isCandidateKey)
    .filter((key) => probability(answers[key]) >= threshold)
    .sort();
}

function candidateCount(answers: DecisionAnswers): number {
  return Object.keys(answers).filter(isCandidateKey).length;
}

export const SKILL_NEEDED_THRESHOLD = 0.5;

export const skillSelection: DecisionDefinition = {
  id: "skill_selection",
  version: "2026-09-20.1",
  // Every linked skill is loaded today. This records which ones the request
  // needed, so trimming can be judged on evidence before it changes a prompt.
  defaultMode: "shadow",
  timeoutMs: 3000,
  escalate: false,
  questions: {
    anySkill: {
      type: "boolean",
      instructions:
        "Does carrying out the request call for any of the listed skills?",
    },
  },
  candidateQuestion: (key) => ({
    type: "boolean",
    instructions: `Does carrying out the request call for the skill labelled ${key}?`,
    criteria: {
      true: "The skill covers work the request asks for.",
      false: "The request can be carried out well without this skill.",
    },
  }),
  interpret(answers: DecisionAnswers) {
    const total = candidateCount(answers);
    const needed = candidatesAtOrAbove(answers, SKILL_NEEDED_THRESHOLD).length;
    const verdict =
      needed === 0 ? "none_needed" : needed === total ? "all_needed" : "some";
    return { verdict, act: needed < total, uncertain: false };
  },
};

export const MEMORY_RELEVANT_THRESHOLD = 0.2;

export const memoryRelevance: DecisionDefinition = {
  id: "memory_relevance",
  version: "2026-09-20.1",
  // Memories reach the prompt by lane budget today. This records which ones
  // bear on the request, next to what was injected, and changes nothing.
  defaultMode: "shadow",
  timeoutMs: 3000,
  escalate: false,
  questions: {},
  candidateQuestion: (key) => ({
    type: "boolean",
    instructions: `Should an assistant handling the request take the memory labelled ${key} into account?`,
    criteria: {
      true: "The memory concerns the same subject as the request, or states a standing preference, convention, or rule that applies to this kind of work.",
      false:
        "The memory concerns a different subject and would not change how the request is handled.",
    },
  }),
  interpret(answers: DecisionAnswers) {
    const total = candidateCount(answers);
    const kept = candidatesAtOrAbove(answers, MEMORY_RELEVANT_THRESHOLD).length;
    return {
      verdict:
        kept === total ? "keep_all" : kept === 0 ? "drop_all" : "drop_some",
      act: kept < total,
      uncertain: false,
    };
  },
};
