import { describe, expect, it } from "vitest";
import { buildDecisionQuestions } from "./decide";
import { getDecisionDefinition } from "./definitions";
import {
  candidateKey,
  candidatesAtOrAbove,
  MEMORY_RELEVANT_THRESHOLD,
  SKILL_NEEDED_THRESHOLD,
} from "./definitions-selection";
import type { DecisionAnswers } from "./types";

function yes(probabilities: Record<string, number>): DecisionAnswers {
  return Object.fromEntries(
    Object.entries(probabilities).map(([key, probability]) => [
      key,
      { type: "boolean" as const, probability },
    ])
  );
}

describe("candidate keys", () => {
  it("should be short, ordered, and zero padded", () => {
    expect([0, 8, 9, 47].map(candidateKey)).toEqual([
      "c01",
      "c09",
      "c10",
      "c48",
    ]);
  });

  it("should select candidates at or above the threshold and ignore fixed questions", () => {
    expect(
      candidatesAtOrAbove(yes({ c02: 0.5, c01: 0.49, anySkill: 0.99 }), 0.5)
    ).toEqual(["c02"]);
  });
});

describe("skill_selection", () => {
  const definition = getDecisionDefinition("skill_selection");

  it("should observe only and ask one labelled question per skill", () => {
    expect(definition.defaultMode).toBe("shadow");
    expect(definition.surfaceModes).toBeUndefined();
    const questions = buildDecisionQuestions(definition, ["c01", "c02"]);
    expect(Object.keys(questions)).toEqual(["anySkill", "c01", "c02"]);
    expect(questions.c02?.instructions).toContain("labelled c02");
  });

  it("should report that a trim is possible when some skills are not needed", () => {
    expect(
      definition.interpret(
        yes({ anySkill: 0.9, c01: SKILL_NEEDED_THRESHOLD, c02: 0.1 })
      )
    ).toEqual({ verdict: "some", act: true, uncertain: false });
  });

  it("should report nothing to trim when every skill is needed", () => {
    expect(definition.interpret(yes({ anySkill: 0.9, c01: 0.8 }))).toEqual({
      verdict: "all_needed",
      act: false,
      uncertain: false,
    });
  });

  it("should report that no skill is needed", () => {
    expect(
      definition.interpret(yes({ anySkill: 0.05, c01: 0.1, c02: 0.2 }))
    ).toEqual({ verdict: "none_needed", act: true, uncertain: false });
  });
});

describe("memory_relevance", () => {
  const definition = getDecisionDefinition("memory_relevance");

  it("should observe only and ask about each memory by its label", () => {
    expect(definition.defaultMode).toBe("shadow");
    expect(definition.surfaceModes).toBeUndefined();
    const questions = buildDecisionQuestions(definition, ["c01"]);
    expect(Object.keys(questions)).toEqual(["c01"]);
    expect(questions.c01?.instructions).toContain("labelled c01");
  });

  it("should keep a memory at the threshold and drop one below it", () => {
    expect(
      definition.interpret(
        yes({
          c01: MEMORY_RELEVANT_THRESHOLD,
          c02: MEMORY_RELEVANT_THRESHOLD - 0.01,
        })
      )
    ).toEqual({ verdict: "drop_some", act: true, uncertain: false });
  });

  it("should separate keeping everything from dropping everything", () => {
    expect(definition.interpret(yes({ c01: 0.9, c02: 0.4 })).verdict).toBe(
      "keep_all"
    );
    expect(definition.interpret(yes({ c01: 0.01 }))).toEqual({
      verdict: "drop_all",
      act: true,
      uncertain: false,
    });
  });
});
