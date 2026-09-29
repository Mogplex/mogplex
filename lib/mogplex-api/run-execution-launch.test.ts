import { describe, expect, it } from "vitest";
import { runSandboxLaunchBody } from "./run-execution-launch";

describe("runSandboxLaunchBody", () => {
  it("should launch the run's repo, branches, and root directory", () => {
    expect(
      runSandboxLaunchBody({
        repo_id: "repo-1",
        base_branch: "main",
        working_branch: "mogplex/run-1",
        create_branch: true,
        root_directory: "apps/web",
      })
    ).toEqual({
      repoId: "repo-1",
      baseBranch: "main",
      workingBranch: "mogplex/run-1",
      createBranch: true,
      rootDirectory: "apps/web",
    });
  });
});
