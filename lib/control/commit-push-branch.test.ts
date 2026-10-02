import { describe, expect, it } from "vitest";
import { resolveCommitPushBranch } from "./commit-push-branch";

describe("commit and push branch", () => {
  it("does not guess from the mission base when no sandbox is present", () => {
    expect(resolveCommitPushBranch(null)).toBeNull();
    expect(resolveCommitPushBranch(undefined)).toBeNull();
    expect(resolveCommitPushBranch({ working_branch: " " })).toBeNull();
  });
  it("uses the sandbox working branch instead of the mission base", () => {
    expect(resolveCommitPushBranch({ working_branch: "feat/fix" })).toBe(
      "feat/fix"
    );
  });
});
