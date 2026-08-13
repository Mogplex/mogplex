import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeWorktreeCommand, WorktreeExecutorError } from "./executor";

describe("executeWorktreeCommand", () => {
  const originalSecret = process.env.INTERNAL_API_SECRET;
  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = "test-internal-secret";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = originalSecret;
  });

  it("preserves a missing sandbox status for explicit binding recovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Sandbox not found", code: "sandbox_not_found" },
          { status: 404 }
        )
      )
    );

    await expect(
      executeWorktreeCommand({
        userId: "user-1",
        sandboxId: "sandbox-1",
        command: "git status",
      })
    ).rejects.toEqual(
      new WorktreeExecutorError("Sandbox not found", 404, "sandbox_not_found")
    );
  });
});
