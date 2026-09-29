import { describe, expect, it } from "vitest";
import {
  autofixSandboxLaunchBody,
  automationHarnessSandboxLaunchBody,
} from "./automation-job-sandbox-setup";

describe("autofixSandboxLaunchBody", () => {
  it("should check out the pull request's head branch of the target repo", () => {
    expect(
      autofixSandboxLaunchBody({
        contextRepo: { default_branch: "trunk" },
        pullRequest: { baseRef: "release", headRef: "fix/login" },
        targetRepo: { id: "fork-1", default_branch: "develop" },
      })
    ).toEqual({
      repoId: "fork-1",
      baseBranch: "release",
      workingBranch: "fix/login",
      createBranch: false,
    });
  });

  it("should fall back from the pull request's base to the target, then the job repo", () => {
    const body = (targetDefault: string | null, contextDefault: string | null) =>
      autofixSandboxLaunchBody({
        contextRepo: { default_branch: contextDefault },
        pullRequest: { baseRef: "", headRef: "fix/login" },
        targetRepo: { id: "fork-1", default_branch: targetDefault },
      }).baseBranch;

    expect(body("develop", "trunk")).toBe("develop");
    expect(body(null, "trunk")).toBe("trunk");
    expect(body(null, null)).toBe("main");
  });
});

describe("automationHarnessSandboxLaunchBody", () => {
  it("should run on the requested branch", () => {
    expect(
      automationHarnessSandboxLaunchBody(
        { id: "repo-1", default_branch: "trunk" },
        { workingBranch: "mogplex/flow-1", createBranch: true }
      )
    ).toEqual({
      repoId: "repo-1",
      baseBranch: "trunk",
      workingBranch: "mogplex/flow-1",
      createBranch: true,
    });
  });

  it("should run on the default branch when no branch is requested", () => {
    expect(
      automationHarnessSandboxLaunchBody({ id: "repo-1", default_branch: null })
    ).toEqual({
      repoId: "repo-1",
      baseBranch: "main",
      workingBranch: "main",
      createBranch: false,
    });
  });
});
