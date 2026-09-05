import { describe, expect, it } from "vitest";
import { assertValidHarness, normalizeStartRequest } from "./runs-normalize";

describe("native external-run harness", () => {
  it("accepts Mogplex and preserves its identity in the normalized request", () => {
    expect(assertValidHarness("mogplex")).toBe("mogplex");
    const { normalized } = normalizeStartRequest({
      body: { repoId: "repo", prompt: "Fix the header", harness: "mogplex" },
      repo: {
        id: "repo",
        full_name: "example/app",
        default_branch: "main",
        root_directory: null,
      },
      idempotencyKey: "slack-event",
    });
    expect(normalized.harness).toBe("mogplex");
    expect(normalized.createBranch).toBe(true);
    expect(normalized.workingBranch).not.toBe("main");
  });
  it("retains existing CLI selection and rejects unknown harnesses", () => {
    expect(assertValidHarness("claude-code")).toBe("claude-code");
    expect(assertValidHarness(undefined)).toBe("codex");
    expect(() => assertValidHarness("other")).toThrow("Invalid harness");
  });
  it("rejects an assigned worktree or the protected base checkout for a native run", () => {
    const normalize = (body: Record<string, unknown>) =>
      normalizeStartRequest({
        body: { repoId: "repo", prompt: "Fix", harness: "mogplex", ...body },
        repo: {
          id: "repo",
          full_name: "example/app",
          default_branch: "main",
          root_directory: null,
        },
        idempotencyKey: "event",
      });
    expect(() => normalize({ worktreeId: "worktree" })).toThrow(
      "assigned worktrees"
    );
    expect(() => normalize({ createBranch: false })).toThrow(
      "isolated working branch"
    );
    expect(() => normalize({ mode: "plan" })).toThrow("CLI execution modes");
  });
});
