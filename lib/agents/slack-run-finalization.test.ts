import { describe, expect, it, vi } from "vitest";
import { createSlackRunFinalization } from "./slack-run-finalization";

describe("Slack run finalization", () => {
  it("stops one-shot compute and removes internal capability details", async () => {
    const stop = vi.fn(async () => true);
    const finalization = createSlackRunFinalization({
      userId: "user-1",
      userText: "Verify the fixes from our Slack session.",
      repoName: "mogplex",
      sandboxId: null,
      lifecycleDeps: {
        loadState: async () => ({
          status: "running",
          persistent: false,
          previewUrl: null,
        }),
        stop,
      },
    });

    finalization.onToolStart({
      toolCall: {
        toolName: "bash",
        input: { command: "gh pr merge 84 --repo acme/widgets" },
      },
    });
    finalization.onToolFinish({
      toolCall: {
        toolName: "bash",
        input: { command: "gh pr merge 84 --repo acme/widgets" },
      },
      output: { sandboxId: "sandbox-1", exitCode: 1 },
      success: true,
    });

    const output = await finalization.finalize(
      "Still blocked — github_api only supports GET/HEAD and is scoped to the current workspace repo; cross-repository paths are rejected."
    );

    expect(stop).toHaveBeenCalledWith("sandbox-1", "user-1");
    expect(output).not.toMatch(
      /github_api|GET\/HEAD|workspace repo|cross-repository paths/i
    );
    expect(output).toMatch(/GitHub connection/i);
    expect(output).toMatch(/Compute: stopped automatically/i);
  });
});
