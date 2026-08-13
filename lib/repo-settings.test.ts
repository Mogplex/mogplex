import { describe, expect, it } from "vitest";
import { resolveSandboxPath } from "./repo-settings";

describe("resolveSandboxPath", () => {
  it("keeps relative files inside an absolute worktree checkout", () => {
    expect(
      resolveSandboxPath(
        "/vercel/sandbox/.worktrees/11111111-2222-4333-8444-555555555555///",
        "./.mcp/config.json"
      )
    ).toBe(
      "/vercel/sandbox/.worktrees/11111111-2222-4333-8444-555555555555/.mcp/config.json"
    );
  });
});
