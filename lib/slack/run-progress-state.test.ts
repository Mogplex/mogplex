import { describe, expect, it } from "vitest";
import {
  applyRunProgress,
  createRunProgressState,
  progressText,
  progressToolResult,
  progressToolTitle,
} from "./run-progress-state";
import { buildRunProgressMessage } from "./run-progress-presentation";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

describe("truthful run progress", () => {
  it("keeps overlapping commands distinct and matches out-of-order completions", () => {
    const state = createRunProgressState(0);
    applyRunProgress(
      state,
      {
        kind: "tool_started",
        toolName: "bash",
        toolCallId: "a",
        input: { command: "pnpm test" },
      },
      1000
    );
    applyRunProgress(
      state,
      {
        kind: "tool_started",
        toolName: "bash",
        toolCallId: "b",
        input: { command: "git diff" },
      },
      2000
    );
    applyRunProgress(
      state,
      {
        kind: "tool_finished",
        toolName: "bash",
        toolCallId: "b",
        state: "success",
        output: { exitCode: 0 },
      },
      3000
    );
    expect(state.tasks.get("a")?.status).toBe("in_progress");
    expect(state.tasks.get("b")).toMatchObject({
      status: "complete",
      finishedAt: 3000,
    });
    applyRunProgress(
      state,
      { kind: "tool_started", toolName: "bash", toolCallId: "b" },
      4000
    );
    expect(state.tasks.size).toBe(2);
    expect(state.tasks.get("b")?.status).toBe("complete");
  });

  it.each([
    [{ exitCode: 1 }, "Command exited with code 1"],
    [{ exitCode: null }, "Command completion could not be verified"],
    [{ ok: false }, "This step did not succeed"],
    [{ error: "private diagnostic" }, "This step did not succeed"],
  ])(
    "does not turn invocation success into operation success: %j",
    (output, result) => {
      expect(progressToolResult("success", output)).toEqual({
        status: "error",
        result,
      });
    }
  );

  it("buffers fragments until a boundary, sanitizing the complete segment", () => {
    const state = createRunProgressState(0);
    expect(
      applyRunProgress(
        state,
        { kind: "assistant_text", text: "Reading /vercel/" },
        1000
      )
    ).toBe(false);
    expect(state.summary).toBe("");
    applyRunProgress(
      state,
      { kind: "assistant_text", text: "sandbox/components/header.tsx" },
      2000
    );
    applyRunProgress(state, { kind: "assistant_text_end" }, 3000);
    expect(state.summary).toContain("components/header.tsx");
    expect(state.summary).not.toContain("/vercel");
    applyRunProgress(
      state,
      { kind: "assistant_text", text: "Now verifying the layout." },
      4000
    );
    applyRunProgress(state, { kind: "tool_started", toolName: "bash" }, 5000);
    expect(state.summary).toBe("Now verifying the layout.");
  });

  it("shows task identity, meaningful phase, next action and exact activity time", () => {
    const state = createRunProgressState(1000);
    applyRunProgress(
      state,
      {
        kind: "phase",
        phase: "Verifying",
        summary: "Adjusted the header layout.",
        next: "Check mobile and desktop.",
      },
      5000
    );
    const message = buildRunProgressMessage(
      {
        id: "run-1",
        metadata: { slack_task_title: "Fix mobile canvas controls" },
        working_branch: "fix/header",
      },
      state
    );
    expect(message.blocks[0]).toEqual({
      type: "header",
      text: { type: "plain_text", text: "Fix mobile canvas controls" },
    });
    expect(message.text).toContain("Verifying");
    expect(message.text).toContain("Next: Check mobile and desktop.");
    expect(message.text).toContain("1970-01-01T00:00:05.000Z");
    expect(message.text).not.toMatch(/\d+%|healthy|seconds remaining/i);
  });

  it("never renders shell arguments or triggers Slack mentions", () => {
    expect(
      progressToolTitle("bash", {
        command: "curl -H 'Authorization: secret' https://private.local",
      })
    ).toBe("Running a command");
    expect(progressText("Found <!channel> <@U123> issues")).toBe(
      "Found issues"
    );
    const state = createRunProgressState(0);
    applyRunProgress(
      state,
      { kind: "tool_started", toolName: "private_tool_name" },
      1000
    );
    expect(
      buildRunProgressMessage({ id: "run-1", metadata: {} }, state).text
    ).not.toContain("private_tool_name");
  });

  it("does not render the reporting tool as work performed", () => {
    const state = createRunProgressState(0);
    applyRunProgress(
      state,
      { kind: "tool_started", toolName: "report_progress", toolCallId: "p1" },
      1000
    );
    applyRunProgress(
      state,
      {
        kind: "tool_finished",
        toolName: "report_progress",
        toolCallId: "p1",
        state: "success",
      },
      2000
    );
    expect(state.tasks.size).toBe(0);
  });
});
