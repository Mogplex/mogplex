import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt pull request delivery", () => {
  it("keeps routine pull request metadata edits inside the agent run", () => {
    const prompt = buildSystemPrompt({
      repoFullName: "acme/demo",
      repoOwner: "acme",
      repoName: "demo",
      repoBranch: "mogplex/fix-slack",
      repoBaseBranch: "main",
      sandboxId: "sandbox-1",
    });

    expect(prompt).toMatch(
      /use github_update_pull_request instead of asking the user to edit it/
    );
  });
});
