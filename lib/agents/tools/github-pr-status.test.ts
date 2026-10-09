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

  it("guides models to treat required as blocking in the description", () => {
    // The description is the contract for how models interpret the output.
    // Actual normalization (isRequired -> required: null) is tested via
    // integration tests that mock the GitHub API response.
    const tool = createGithubPullRequestStatusTool({ userId: "user-1" });
    expect(tool.description).toMatch(/required.*blocking/i);
  });
});
