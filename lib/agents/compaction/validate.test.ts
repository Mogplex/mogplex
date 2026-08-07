import { describe, expect, it } from "vitest";
import { validateCheckpoint } from "./validate";
import type { AgentCheckpoint, CompactableAgentMessage } from "./types";

function msg(role: string, text: string): CompactableAgentMessage {
  return { role, content: text };
}

function makeCheckpoint(
  overrides?: Partial<{
    originalRequest: string;
    nextAction: string;
    changedFiles: string[];
    blockers: string[];
  }>
): AgentCheckpoint {
  return {
    task: {
      originalRequest:
        overrides?.originalRequest ?? "add rate limiting to the api",
      currentObjective: "wire the middleware",
    },
    progress: {
      completed: ["read the routes"],
      active: null,
      remaining: ["add tests"],
      blockers: overrides?.blockers ?? [],
    },
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
    continuity: {
      nextAction: overrides?.nextAction ?? "edit middleware.ts",
      warnings: [],
    },
    provenance: {
      id: "cp-1",
      parentCheckpointId: null,
      createdAt: "2026-08-07T00:00:00.000Z",
      coveredMessageCount: 2,
      compactorModel: "test-model",
      schemaVersion: 1,
    },
  };
}

const covered = [
  msg("user", "Add rate limiting to the API please"),
  msg("assistant", "I changed lib/middleware.ts and ran the tests"),
];

describe("validateCheckpoint", () => {
  it("should accept a checkpoint whose claims trace to the transcript", () => {
    const result = validateCheckpoint({
      checkpoint: makeCheckpoint({ changedFiles: ["lib/middleware.ts"] }),
      covered,
    });
    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("should reject an empty next action", () => {
    const result = validateCheckpoint({
      checkpoint: makeCheckpoint({ nextAction: "  " }),
      covered,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("next_action_empty");
  });

  it("should reject an original request the user never made", () => {
    const result = validateCheckpoint({
      checkpoint: makeCheckpoint({
        originalRequest: "delete the production database",
      }),
      covered,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "original_request_does_not_trace_to_user"
    );
  });

  it("should accept a lightly paraphrased long original request", () => {
    const request =
      "please migrate the billing reconciliation worker to the new queue and keep the retry semantics identical";
    const result = validateCheckpoint({
      checkpoint: makeCheckpoint({ originalRequest: request }),
      covered: [
        msg(
          "user",
          "Can you migrate our billing reconciliation worker over to the new queue? Retry semantics must stay identical."
        ),
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("should reject changed files that never appear in the transcript", () => {
    const result = validateCheckpoint({
      checkpoint: makeCheckpoint({ changedFiles: ["lib/invented.ts"] }),
      covered,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "changed_file_not_in_transcript:lib/invented.ts"
    );
  });

  it("should reject silently dropped blockers from the previous checkpoint", () => {
    const previous = makeCheckpoint({
      blockers: ["waiting on staging access"],
    });
    const result = validateCheckpoint({
      checkpoint: makeCheckpoint(),
      covered,
      previousCheckpoint: previous,
    });
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((failure) => failure.startsWith("blocker_dropped:"))
    ).toBe(true);
  });

  it("should accept a previous blocker that stays open or is mentioned", () => {
    const previous = makeCheckpoint({
      blockers: ["waiting on staging access"],
    });
    const result = validateCheckpoint({
      checkpoint: makeCheckpoint({ blockers: ["waiting on staging access"] }),
      covered,
      previousCheckpoint: previous,
    });
    expect(result.ok).toBe(true);
  });
});
