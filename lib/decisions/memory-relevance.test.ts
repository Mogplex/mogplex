import { describe, expect, it } from "vitest";
import type { CandidateDecideFn } from "./candidates";
import { observeMemoryRelevance } from "./memory-relevance";

const scope = { surface: "control", userId: "user-1", teamId: "team-1" };

function recorder() {
  const calls: Parameters<CandidateDecideFn>[] = [];
  const decideFn: CandidateDecideFn = async (...args) => {
    calls.push(args);
    return { status: "ok", verdict: "keep_all" };
  };
  return { calls, decideFn };
}

describe("observeMemoryRelevance", () => {
  it("should label every injected memory and keep its id and section out of the judged state", async () => {
    const { calls, decideFn } = recorder();

    await observeMemoryRelevance(
      {
        request: "Rename the billing page",
        groups: {
          semantic: [{ id: "m-1", content: "Uses pnpm." }],
          procedural: [],
          relevant: [{ id: "m-2", content: `  ${"y".repeat(2000)}  ` }],
        },
        scope,
      },
      decideFn
    );

    expect(calls).toHaveLength(1);
    const [id, state, askedScope, options] = calls[0] ?? [];
    expect(id).toBe("memory_relevance");
    expect(askedScope).toBe(scope);
    const judged = state as {
      request: string;
      memories: Record<string, string>;
    };
    expect(judged.request).toBe("Rename the billing page");
    expect(judged.memories.c01).toBe("Uses pnpm.");
    expect(judged.memories.c02?.length).toBeLessThan(700);
    expect(JSON.stringify(state)).not.toContain("m-1");
    expect(options).toMatchObject({
      candidates: ["c01", "c02"],
      baseline: {
        injected: 2,
        byGroup: { semantic: 1, procedural: 0, relevant: 1 },
      },
      metadata: {
        omitted: 0,
        candidates: {
          c01: { id: "m-1", group: "semantic" },
          c02: { id: "m-2", group: "relevant" },
        },
      },
    });
  });

  it("should ask nothing without memories or without request text", async () => {
    const { calls, decideFn } = recorder();

    await observeMemoryRelevance(
      { request: "hello", groups: { semantic: [] }, scope },
      decideFn
    );
    await observeMemoryRelevance(
      {
        request: " ",
        groups: { semantic: [{ id: "m", content: "x" }] },
        scope,
      },
      decideFn
    );

    expect(calls).toHaveLength(0);
  });

  it("should never reject when the check itself throws", async () => {
    await expect(
      observeMemoryRelevance(
        {
          request: "hi",
          groups: { semantic: [{ id: "m", content: "x" }] },
          scope,
        },
        async () => {
          throw new Error("boom");
        }
      )
    ).resolves.toBeUndefined();
  });
});
