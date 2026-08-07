import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import {
  compactConversation,
  extractMessageText,
  HANDOFF_PREFIX,
  matchCheckpointPrefix,
  type CheckpointGenerator,
  type CompactableAgentMessage,
  type StoredCompaction,
} from "./index";
import type { AgentCheckpointBody } from "./types";

const model = "fake-model" as unknown as LanguageModel;

function msg(role: string, text: string): CompactableAgentMessage {
  return { role, content: text };
}

function buildHandoffMessage(handoffText: string): CompactableAgentMessage {
  return { role: "user", content: handoffText };
}

function makeBody(
  overrides?: Partial<AgentCheckpointBody["task"]> & {
    changedFiles?: string[];
  }
): AgentCheckpointBody {
  return {
    task: {
      originalRequest: overrides?.originalRequest ?? "build the widget",
      currentObjective: overrides?.currentObjective ?? "finish the widget",
    },
    progress: { completed: [], active: null, remaining: [], blockers: [] },
    state: {
      decisions: [],
      assumptions: [],
      constraints: [],
      rejectedApproaches: [],
    },
    workspace: {
      changedFiles: overrides?.changedFiles ?? [],
      relevantFiles: [],
    },
    evidence: [],
    unresolvedQuestions: [],
    continuity: { nextAction: "continue building", warnings: [] },
  };
}

const okGenerator: CheckpointGenerator = async () => makeBody();

const big = "z".repeat(400);

function longHistory(turns: number): CompactableAgentMessage[] {
  return Array.from({ length: turns }, (_, index) => [
    msg("user", index === 0 ? "build the widget" : `ask ${index} ${big}`),
    msg("assistant", `reply ${index} ${big}`),
  ]).flat();
}

describe("compactConversation", () => {
  it("should pass small histories through unchanged", async () => {
    const messages = [msg("user", "hi"), msg("assistant", "hello")];
    const result = await compactConversation({
      messages,
      model,
      compactorModelId: "m",
      buildHandoffMessage,
      generate: okGenerator,
      charBudget: 10_000,
      keepRecent: 2,
    });
    expect(result.outcome).toBe("unchanged");
    expect(result.messages).toEqual(messages);
  });

  it("should compact an oversized history into handoff + recent turns", async () => {
    const messages = longHistory(6);
    const result = await compactConversation({
      messages,
      model,
      compactorModelId: "m",
      buildHandoffMessage,
      generate: okGenerator,
      charBudget: 1_000,
      keepRecent: 3,
    });
    if (result.outcome !== "compacted") {
      throw new Error(`expected compacted, got ${result.outcome}`);
    }
    const handoffText = extractMessageText(result.messages[0]);
    expect(handoffText).toContain(HANDOFF_PREFIX);
    // User words survive verbatim in the handoff.
    expect(handoffText).toContain("build the widget");
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.event.validation.ok).toBe(true);
    expect(result.event.coveredMessageCount).toBeGreaterThan(0);
    expect(result.event.charsAfter).toBeLessThan(result.event.charsBefore);
    expect(result.checkpoint.provenance.parentCheckpointId).toBeNull();
  });

  it("should reuse a stored checkpoint whose prefix is intact", async () => {
    const messages = longHistory(6);
    const first = await compactConversation({
      messages,
      model,
      compactorModelId: "m",
      buildHandoffMessage,
      generate: okGenerator,
      charBudget: 1_000,
      keepRecent: 3,
    });
    if (first.outcome !== "compacted") throw new Error("expected compacted");

    const stored: StoredCompaction = {
      checkpoint: first.checkpoint,
      handoff: first.event.handoff,
      prefixHash: first.event.prefixHash,
      coveredMessageCount: first.event.coveredMessageCount,
    };
    let called = 0;
    const countingGenerator: CheckpointGenerator = async () => {
      called += 1;
      return makeBody();
    };
    const second = await compactConversation({
      messages,
      model,
      compactorModelId: "m",
      previous: stored,
      buildHandoffMessage,
      generate: countingGenerator,
      // Generous budget: after applying the checkpoint nothing else needs
      // compacting, so no new model call may happen.
      charBudget: 100_000,
      keepRecent: 3,
    });
    if (second.outcome !== "reused") {
      throw new Error(`expected reused, got ${second.outcome}`);
    }
    expect(called).toBe(0);
    expect(second.checkpointId).toBe(first.checkpoint.provenance.id);
    expect(extractMessageText(second.messages[0])).toContain(HANDOFF_PREFIX);
  });

  it("should chain compaction after reuse with fingerprints in original-history terms", async () => {
    const messages = longHistory(6);
    const first = await compactConversation({
      messages,
      model,
      compactorModelId: "m",
      buildHandoffMessage,
      generate: okGenerator,
      charBudget: 1_000,
      keepRecent: 3,
    });
    if (first.outcome !== "compacted") throw new Error("expected compacted");

    // The conversation keeps growing past the budget again.
    const grown = [
      ...messages,
      ...longHistory(6).map((m, i) =>
        msg(m.role, `${extractMessageText(m)} regrown ${i}`)
      ),
    ];
    const stored: StoredCompaction = {
      checkpoint: first.checkpoint,
      handoff: first.event.handoff,
      prefixHash: first.event.prefixHash,
      coveredMessageCount: first.event.coveredMessageCount,
    };
    const second = await compactConversation({
      messages: grown,
      model,
      compactorModelId: "m",
      previous: stored,
      buildHandoffMessage,
      generate: okGenerator,
      charBudget: 1_000,
      keepRecent: 3,
    });
    if (second.outcome !== "compacted") {
      throw new Error(`expected compacted, got ${second.outcome}`);
    }
    expect(second.checkpoint.provenance.parentCheckpointId).toBe(
      first.checkpoint.provenance.id
    );
    // The stored fingerprint must match the original client history so the
    // NEXT turn can reuse this chained checkpoint.
    const match = matchCheckpointPrefix(grown, {
      prefixHash: second.event.prefixHash,
      coveredMessageCount: second.event.coveredMessageCount,
    });
    expect(match).not.toBeNull();
    // And the range it denotes must be exactly what the chained checkpoint
    // compacted: applying it next turn must yield the same retained tail this
    // compaction kept (second.messages minus the injected handoff), or the
    // covered/suffix boundary drifted and turns get duplicated or lost.
    expect(match?.suffix).toEqual(second.messages.slice(1));
  });

  it("should fail closed when validation rejects the checkpoint", async () => {
    const messages = longHistory(6);
    const badGenerator: CheckpointGenerator = async () =>
      makeBody({ changedFiles: ["lib/never-mentioned.ts"] });
    const result = await compactConversation({
      messages,
      model,
      compactorModelId: "m",
      buildHandoffMessage,
      generate: badGenerator,
      charBudget: 1_000,
      keepRecent: 3,
    });
    if (result.outcome !== "failed") {
      throw new Error(`expected failed, got ${result.outcome}`);
    }
    expect(result.messages).toEqual(messages);
    expect(result.event?.validation.ok).toBe(false);
  });

  it("should fail closed when the generator throws", async () => {
    const messages = longHistory(6);
    const throwingGenerator: CheckpointGenerator = async () => {
      throw new Error("provider down");
    };
    const result = await compactConversation({
      messages,
      model,
      compactorModelId: "m",
      buildHandoffMessage,
      generate: throwingGenerator,
      charBudget: 1_000,
      keepRecent: 3,
    });
    if (result.outcome !== "failed") {
      throw new Error(`expected failed, got ${result.outcome}`);
    }
    expect(result.event).toBeNull();
    expect(result.error).toContain("provider down");
    expect(result.messages).toEqual(messages);
  });
});
