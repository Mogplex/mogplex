import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  buildActivityEntries,
  buildTerminalActivityEntries,
} from "./activity-stream";

function message(toolName: string, output: unknown): UIMessage[] {
  return [
    {
      id: "assistant",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName,
          toolCallId: "tool-1",
          state: "output-available",
          input: { command: "pnpm test" },
          output,
        },
      ],
    },
  ];
}

describe("execution outcomes", () => {
  it.each([
    { status: "error", error: "Sandbox failed before it became ready." },
    { status: "failed" },
    { success: false },
    { exitCode: 1, stderr: "Tests failed" },
  ])("does not display a returned failure as success: %j", (output) => {
    const messages = message("run_command", output);
    expect(buildTerminalActivityEntries(messages)[0].state).toBe("failed");
    expect(buildActivityEntries(messages)[0]).toMatchObject({
      state: "failed",
    });
  });

  it("does not report a pending sandbox as ready", () => {
    expect(
      buildTerminalActivityEntries(
        message("sandbox_start", { status: "pending" })
      )[0].state
    ).toBe("running");
  });

  it("recognizes Bash commands emitted by CLI workers", () => {
    expect(
      buildTerminalActivityEntries(
        message("Bash", { exitCode: 0, stdout: "passed" })
      )[0]
    ).toMatchObject({ command: "pnpm test", state: "done", lines: ["passed"] });
  });

  it("keeps worker identity separate from coordinator commands", () => {
    const workerMessages = message("Command", { stdout: "worker output" });
    workerMessages[0].metadata = { workerBranch: "fix/worker-tests" };
    const entries = buildTerminalActivityEntries([
      ...message("run_command", { stdout: "coordinator output" }),
      ...workerMessages,
    ]);
    expect(entries[0].workerBranch).toBeUndefined();
    expect(entries[1]).toMatchObject({
      workerBranch: "fix/worker-tests",
      lines: ["worker output"],
    });
  });
});
