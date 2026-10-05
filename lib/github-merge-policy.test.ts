import { describe, expect, it } from "vitest";
import {
  enforceMergePolicy,
  type MergeApprovalTarget,
  type MergePolicyDeps,
} from "./github-merge-policy";

const target: MergeApprovalTarget = {
  userId: "user",
  teamId: "team",
  owner: "acme",
  repo: "widgets",
  number: 84,
  expectedHeadSha: "a".repeat(40),
  commitTitle: "Approved title",
};
const DEFAULT_POLICY = { requireApproval: false, contextRepoOnly: false };
function deps(
  policy: {
    requireApproval: boolean;
    contextRepoOnly: boolean;
  } = DEFAULT_POLICY
): MergePolicyDeps {
  return {
    read: async () => policy,
    claimApproval: async () => null,
    requestApproval: async () => "pending",
  };
}

describe("team merge policy", () => {
  it("keeps both restrictions opt-in", async () => {
    expect(await enforceMergePolicy(target, undefined, deps())).toEqual({
      allowed: true,
    });
    expect(
      await enforceMergePolicy(target, undefined, deps(), "queue")
    ).toEqual({ allowed: true });
    expect(
      await enforceMergePolicy(target, undefined, deps(), "review")
    ).toEqual({ allowed: true });
  });
  it("refuses queue-only approval without claiming or requesting a target", async () => {
    let approvalCalls = 0;
    const storage = {
      ...deps({ requireApproval: true, contextRepoOnly: false }),
      claimApproval: async () => {
        approvalCalls += 1;
        return "approved";
      },
      requestApproval: async () => {
        approvalCalls += 1;
        return "pending";
      },
    };
    expect(
      await enforceMergePolicy(target, undefined, storage, "queue")
    ).toMatchObject({
      allowed: false,
      decision: "immediate_merge_required",
      error: expect.stringMatching(/direct merge tool/i),
    });
    expect(approvalCalls).toBe(0);
    expect(
      await enforceMergePolicy(target, undefined, storage, "review")
    ).toMatchObject({
      allowed: false,
      decision: "merge_deferred",
      error: expect.stringMatching(/review check to complete/i),
    });
    expect(approvalCalls).toBe(0);
  });
  it("requires a full reviewed SHA before using or creating an approval", async () => {
    let approvalCalls = 0;
    const storage = {
      ...deps({ requireApproval: true, contextRepoOnly: false }),
      claimApproval: async () => {
        approvalCalls += 1;
        return "approved";
      },
    };
    for (const expectedHeadSha of [
      "",
      "abc",
      "g".repeat(40),
      `prefix${"a".repeat(40)}`,
      `${"a".repeat(40)}suffix`,
    ]) {
      expect(
        await enforceMergePolicy(
          { ...target, expectedHeadSha },
          undefined,
          storage
        )
      ).toMatchObject({
        allowed: false,
        decision: "merge_policy_unavailable",
        error: expect.stringMatching(/review the current head/i),
      });
    }
    expect(approvalCalls).toBe(0);
  });
  it("matches run repositories without case differences and still requires approval", async () => {
    expect(
      await enforceMergePolicy(
        target,
        { owner: "ACME", repo: "Widgets" },
        deps({ requireApproval: true, contextRepoOnly: true })
      )
    ).toMatchObject({
      allowed: false,
      decision: "approval_required",
      approvalId: "pending",
      error: expect.stringMatching(/Team settings > Members > Agent merges/),
    });
  });
  it("refuses contextless and cross-repository merges before touching approval storage", async () => {
    let approvalCalls = 0;
    const storage = {
      ...deps({ requireApproval: true, contextRepoOnly: true }),
      claimApproval: async () => {
        approvalCalls += 1;
        return "approved";
      },
    };
    for (const context of [
      undefined,
      {},
      { owner: "acme" },
      { repo: "widgets" },
      { owner: "other", repo: "widgets" },
      { owner: "acme", repo: "other" },
    ]) {
      expect(await enforceMergePolicy(target, context, storage)).toMatchObject({
        allowed: false,
        decision: "outside_context_repo",
        error: expect.stringMatching(/run's repository/i),
      });
    }
    expect(approvalCalls).toBe(0);
  });
  it("passes the entire exact target to approval storage and consumes before allowing", async () => {
    const bound: MergeApprovalTarget[] = [];
    const storage = {
      ...deps({ requireApproval: true, contextRepoOnly: false }),
      claimApproval: async (input: MergeApprovalTarget) => {
        bound.push(input);
        return "approved";
      },
      requestApproval: async () => {
        throw new Error("Should not request twice");
      },
    };
    expect(await enforceMergePolicy(target, undefined, storage)).toEqual({
      allowed: true,
      approvalId: "approved",
      immediateOnly: true,
    });
    expect(bound).toEqual([target]);
  });
  it("fails closed when reading, claiming, or persisting approval fails", async () => {
    for (const key of ["read", "claimApproval", "requestApproval"] as const) {
      const storage = {
        ...deps({ requireApproval: true, contextRepoOnly: false }),
        [key]: async () => {
          throw new Error("private diagnostic");
        },
      };
      const result = await enforceMergePolicy(target, undefined, storage);
      expect(result).toMatchObject({
        allowed: false,
        decision: "merge_policy_unavailable",
        error: expect.stringMatching(/No merge was started/),
      });
      expect(JSON.stringify(result)).not.toContain("private diagnostic");
    }
  });
});
