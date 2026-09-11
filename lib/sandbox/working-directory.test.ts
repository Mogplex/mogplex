import { describe, expect, it } from "vitest";
import {
  SANDBOX_WORKSPACE_ROOT,
  resolveSandboxWorkingDirectory,
} from "./working-directory";

describe("resolveSandboxWorkingDirectory", () => {
  it("defaults to the checkout root when nothing is requested", () => {
    expect(resolveSandboxWorkingDirectory(undefined)).toBe(
      SANDBOX_WORKSPACE_ROOT
    );
    expect(resolveSandboxWorkingDirectory("  ", null)).toBe(
      SANDBOX_WORKSPACE_ROOT
    );
  });

  it("treats '.' and relative paths as repository-relative", () => {
    expect(resolveSandboxWorkingDirectory(".")).toBe(SANDBOX_WORKSPACE_ROOT);
    expect(resolveSandboxWorkingDirectory("apps/web")).toBe(
      "/vercel/sandbox/apps/web"
    );
    expect(resolveSandboxWorkingDirectory("./apps/web/")).toBe(
      "/vercel/sandbox/apps/web"
    );
  });

  it("resolves relative paths from the launch subdirectory", () => {
    expect(resolveSandboxWorkingDirectory(undefined, "apps/web")).toBe(
      "/vercel/sandbox/apps/web"
    );
    expect(resolveSandboxWorkingDirectory("src", "apps/web")).toBe(
      "/vercel/sandbox/apps/web/src"
    );
    expect(resolveSandboxWorkingDirectory("..", "apps/web")).toBe(
      "/vercel/sandbox/apps"
    );
  });

  it("accepts an absolute checkout as the root directory", () => {
    expect(
      resolveSandboxWorkingDirectory(undefined, "/vercel/sandbox/.worktrees/a")
    ).toBe("/vercel/sandbox/.worktrees/a");
    expect(
      resolveSandboxWorkingDirectory("src", "/vercel/sandbox/.worktrees/a/")
    ).toBe("/vercel/sandbox/.worktrees/a/src");
  });

  it("keeps absolute paths as they are", () => {
    expect(resolveSandboxWorkingDirectory("/tmp/work/", "apps/web")).toBe(
      "/tmp/work"
    );
    expect(resolveSandboxWorkingDirectory("/")).toBe("/");
  });
});
