import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { latestTaskSandbox, resolveTaskSandbox } from "./task-sandbox";

function result(
  toolName: string,
  output: unknown,
  toolCallId = "call"
): UIMessage {
  return {
    id: toolCallId,
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName,
        toolCallId,
        input: {},
        output,
        state: "output-available",
      },
    ],
  };
}

describe("task sandbox binding", () => {
  it("uses the last sandbox the task actually used", () => {
    expect(
      latestTaskSandbox([
        result("sandbox_start", { sandboxId: "first" }, "start"),
        result("run_command", { sandboxId: "second", exitCode: 1 }, "command"),
      ])
    ).toEqual({ sandboxId: "second", callId: "command" });
  });
  it("ignores failed launches and workers in other environments", () => {
    expect(
      latestTaskSandbox([
        result("sandbox_start", { sandboxId: "first" }),
        result("sandbox_start", { sandboxId: "bad", status: "error" }, "bad"),
        result("spawn_subagent", { sandboxId: "worker" }, "worker"),
      ])
    ).toEqual({ sandboxId: "first", callId: "call" });
  });
  it("does not infer an environment from conversation text or invalid output", () => {
    expect(
      latestTaskSandbox([
        result("run_command", null),
        result("run_command", { sandboxId: 12 }),
        {
          id: "user",
          role: "user",
          parts: [{ type: "text", text: "sandboxId: unrelated" }],
        },
      ])
    ).toBeNull();
  });
});

const sandboxes = ["one", "two"].map((id) => ({
  id,
  runtime_summary: { status: "running" },
}));
describe("task environment selection", () => {
  it("requires a choice when more than one environment exists", () => {
    expect(resolveTaskSandbox(sandboxes, null, null)).toBeNull();
    expect(resolveTaskSandbox([sandboxes[1]], null, null)).toBe(sandboxes[1]);
  });
  it("honors a manual choice until a new command binds another environment", () => {
    const selected = { sandboxId: "two", observedCallId: "old-command" };
    expect(
      resolveTaskSandbox(sandboxes, selected, {
        sandboxId: "one",
        callId: "old-command",
      })
    ).toBe(sandboxes[1]);
    expect(
      resolveTaskSandbox(sandboxes, selected, {
        sandboxId: "one",
        callId: "new-command",
      })
    ).toBe(sandboxes[0]);
  });
  it("never replaces a missing task environment with an unrelated VM", () => {
    expect(
      resolveTaskSandbox(
        sandboxes,
        { sandboxId: "missing", observedCallId: null },
        null
      )
    ).toBeNull();
    expect(
      resolveTaskSandbox(sandboxes, null, {
        sandboxId: "missing",
        callId: "command",
      })
    ).toBeNull();
  });
});
