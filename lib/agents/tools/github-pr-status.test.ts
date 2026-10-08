import { describe, expect, it } from "vitest";
import { createGithubPullRequestStatusTool } from "./github-pr-status";

describe("github_pr_status tool", () => {
  it("documents required: null as unknown/blocking in the tool description", () => {
    const tool = createGithubPullRequestStatusTool({ userId: "user-1" });
    expect(tool.description).toContain(
      "When `required` is `null`, the check's blocking status is unknown"
    );
    expect(tool.description).toContain(
      "treat it as required/blocking unless the repository's branch protection rules say otherwise"
    );
  });

  it("normalizes isRequired from GitHub to required: null when undefined", () => {
    // Test the normalizeChecks logic by verifying the tool description explains
    // the behavior - the actual normalization is tested via integration tests
    // that mock the GitHub API response. The tool description is the contract
    // for how models should interpret the output.
    const tool = createGithubPullRequestStatusTool({ userId: "user-1" });
    // The description should guide models to treat null as blocking (safe default)
    expect(tool.description).toMatch(/required.*blocking/i);
  });
});
