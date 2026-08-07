import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import type { AgentCheckpoint } from "@/lib/agents/compaction";
import {
  filterPromotionCandidates,
  isDuplicateContent,
  promoteMemoriesFromCheckpoint,
  PROMOTION_MAX_PER_RUN,
  type PromotionCandidate,
  type PromotionDeps,
} from "./memory-promotion";

const model = "fake-model" as unknown as LanguageModel;

function makeCheckpoint(): AgentCheckpoint {
  return {
    task: {
      originalRequest: "wire the billing webhooks",
      currentObjective: "finish webhook retries",
    },
    progress: {
      completed: ["created stripe webhook route"],
      active: null,
      remaining: [],
      blockers: [],
    },
    state: {
      decisions: ["the project uses pnpm as its package manager"],
      assumptions: [],
      constraints: ["never deploy without approval"],
      rejectedApproaches: [],
    },
    workspace: { changedFiles: [], relevantFiles: [] },
    evidence: [],
    unresolvedQuestions: [],
    continuity: { nextAction: "add retry backoff", warnings: [] },
    provenance: {
      id: "ckpt-1",
      parentCheckpointId: null,
      createdAt: "2026-08-07T00:00:00.000Z",
      coveredMessageCount: 20,
      compactorModel: "m",
      schemaVersion: 1,
    },
  };
}

function candidate(
  overrides?: Partial<PromotionCandidate>
): PromotionCandidate {
  return {
    content: "This project uses pnpm as its package manager.",
    lane: "semantic",
    confidence: 0.9,
    reasoning: "stated as a project decision",
    evidence: ["the project uses pnpm as its package manager"],
    ...overrides,
  };
}

describe("filterPromotionCandidates", () => {
  const checkpoint = makeCheckpoint();

  it("should accept a confident, evidence-backed candidate", () => {
    const { accepted, rejected } = filterPromotionCandidates({
      candidates: [candidate()],
      checkpoint,
    });
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("should reject low-confidence candidates", () => {
    const { accepted, rejected } = filterPromotionCandidates({
      candidates: [candidate({ confidence: 0.5 })],
      checkpoint,
    });
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toBe("low_confidence");
  });

  it("should reject candidates whose evidence does not trace to the checkpoint", () => {
    const { accepted, rejected } = filterPromotionCandidates({
      candidates: [
        candidate({ evidence: ["something the checkpoint never said"] }),
      ],
      checkpoint,
    });
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toBe("evidence_does_not_trace");
  });

  it("should reject candidates with no evidence at all", () => {
    const { rejected } = filterPromotionCandidates({
      candidates: [candidate({ evidence: [] })],
      checkpoint,
    });
    expect(rejected[0].reason).toBe("no_evidence");
  });

  it("should reject secret-bearing candidates even with valid evidence", () => {
    const { accepted, rejected } = filterPromotionCandidates({
      candidates: [
        candidate({
          content:
            "Deploys authenticate with Bearer sk-live-abc123def456 against the api",
        }),
      ],
      checkpoint,
    });
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toBe("secret_like_content");
  });

  it("should reject too-short and too-long content", () => {
    const { rejected } = filterPromotionCandidates({
      candidates: [
        candidate({ content: "uses pnpm" }),
        candidate({ content: `project fact: ${"x".repeat(2_100)}` }),
      ],
      checkpoint,
    });
    expect(rejected.map((r) => r.reason).sort()).toEqual([
      "too_long",
      "too_short",
    ]);
  });

  it("should cap survivors at the per-run limit, keeping the most confident", () => {
    const many = Array.from({ length: PROMOTION_MAX_PER_RUN + 2 }, (_, i) =>
      candidate({
        content: `The project uses pnpm as its package manager (variant ${i}).`,
        confidence: 0.7 + i * 0.02,
      })
    );
    const { accepted, rejected } = filterPromotionCandidates({
      candidates: many,
      checkpoint,
    });
    expect(accepted).toHaveLength(PROMOTION_MAX_PER_RUN);
    expect(rejected.filter((r) => r.reason === "over_run_cap")).toHaveLength(2);
    // Highest confidence survives.
    expect(accepted[0].confidence).toBeCloseTo(0.7 + 6 * 0.02, 5);
  });
});

describe("isDuplicateContent", () => {
  it("should flag near-identical phrasing as duplicate", () => {
    expect(
      isDuplicateContent(
        "This project uses pnpm as its package manager.",
        "Project uses pnpm for its package manager and workspaces."
      )
    ).toBe(true);
  });

  it("should not flag unrelated facts", () => {
    expect(
      isDuplicateContent(
        "This project uses pnpm as its package manager.",
        "Charles prefers conventional commits."
      )
    ).toBe(false);
  });
});

describe("promoteMemoriesFromCheckpoint", () => {
  function makeDeps(overrides?: Partial<PromotionDeps>): {
    deps: PromotionDeps;
    written: Array<{
      lane: string;
      content: string;
      metadata: Record<string, unknown>;
    }>;
  } {
    const written: Array<{
      lane: string;
      content: string;
      metadata: Record<string, unknown>;
    }> = [];
    const deps: PromotionDeps = {
      generate: async () => ({ candidates: [candidate()] }),
      searchMemories: async () => [],
      addMemory: async (input) => {
        written.push(input);
      },
      now: () => new Date("2026-08-07T12:00:00.000Z"),
      ...overrides,
    };
    return { deps, written };
  }

  it("should write accepted candidates with full provenance", async () => {
    const { deps, written } = makeDeps();
    const result = await promoteMemoriesFromCheckpoint(
      { checkpoint: makeCheckpoint(), aiCallId: "call-9", model },
      deps
    );
    expect(result.promoted).toHaveLength(1);
    expect(written).toHaveLength(1);
    expect(written[0].lane).toBe("semantic");
    expect(written[0].metadata).toMatchObject({
      source: "promotion",
      sourceAiCallId: "call-9",
      sourceCheckpointId: "ckpt-1",
      promotedAt: "2026-08-07T12:00:00.000Z",
      confidence: 0.9,
    });
  });

  it("should skip candidates that duplicate existing memories", async () => {
    const { deps, written } = makeDeps({
      searchMemories: async () => [
        { content: "Project uses pnpm for its package manager." },
      ],
    });
    const result = await promoteMemoriesFromCheckpoint(
      { checkpoint: makeCheckpoint(), aiCallId: "call-9", model },
      deps
    );
    expect(result.promoted).toHaveLength(0);
    expect(result.duplicates).toHaveLength(1);
    expect(written).toHaveLength(0);
  });

  it("should write nothing when every candidate is filtered out", async () => {
    const { deps, written } = makeDeps({
      generate: async () => ({
        candidates: [candidate({ confidence: 0.2 })],
      }),
    });
    const result = await promoteMemoriesFromCheckpoint(
      { checkpoint: makeCheckpoint(), aiCallId: "call-9", model },
      deps
    );
    expect(result.promoted).toHaveLength(0);
    expect(written).toHaveLength(0);
    expect(result.rejected[0].reason).toBe("low_confidence");
  });
});
