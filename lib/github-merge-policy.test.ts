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
};

describe("team merge authorization", () => {
  it("ignores retired settings and never creates or consumes a human approval", async () => {
    const calls: string[] = [];
    const deps: MergePolicyDeps = {
      read: async () => {
        calls.push("permission");
        return { requireApproval: true, contextRepoOnly: true };
      },
    };
    for (const context of [undefined, { owner: "other", repo: "different" }]) {
      for (const mode of ["merge", "queue"] as const) {
        expect(await enforceMergePolicy(target, context, deps, mode)).toEqual({
          allowed: true,
        });
      }
    }
    expect(calls).toEqual(Array.from({ length: 4 }).fill("permission"));
  });

  it("finishes publishing a flow review before continuing its requested merge", async () => {
    const deps: MergePolicyDeps = {
      read: async () => ({ requireApproval: false, contextRepoOnly: false }),
    };
    expect(
      await enforceMergePolicy(target, undefined, deps, "review")
    ).toMatchObject({
      allowed: false,
      decision: "merge_deferred",
      error: expect.stringMatching(/publishing its review check/),
    });
  });

  it("refuses a merge when current team permission cannot be verified", async () => {
    const deps: MergePolicyDeps = {
      read: async () => {
        throw new Error("private database diagnostic");
      },
    };
    const result = await enforceMergePolicy(target, undefined, deps);
    expect(result).toMatchObject({
      allowed: false,
      decision: "merge_policy_unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
