import { describe, expect, it, vi } from "vitest";
import { createRunChatProgressReporter } from "./run-chat-progress";

describe("createRunChatProgressReporter", () => {
  it("emits text and tool lifecycle events in order", async () => {
    const events: unknown[] = [];
    const reporter = createRunChatProgressReporter(async (event) => {
      events.push(event);
    });

    await reporter.toolStarted({
      toolCall: { toolCallId: "tool-1", toolName: "bash" },
    });
    await reporter.toolFinished({
      success: true,
      toolCall: { toolCallId: "tool-1", toolName: "bash" },
    });
    await reporter.modelWorking();
    await reporter.modelWorking();
    await reporter.textDelta("Done");

    expect(events).toEqual([
      {
        type: "tool_started",
        toolCallId: "tool-1",
        toolName: "bash",
      },
      {
        type: "tool_finished",
        toolCallId: "tool-1",
        toolName: "bash",
        success: true,
      },
      {
        type: "model_working",
      },
      {
        type: "text_delta",
        textDelta: "Done",
        accumulatedText: "Done",
      },
    ]);
  });

  it("reports a new reasoning phase after a tool step", async () => {
    const events: unknown[] = [];
    const reporter = createRunChatProgressReporter((event) => {
      events.push(event);
    });

    await reporter.modelWorking();
    await reporter.toolStarted({
      toolCall: { toolCallId: "tool-1", toolName: "bash" },
    });
    await reporter.modelWorking();

    expect(events).toEqual([
      { type: "model_working" },
      { type: "tool_started", toolCallId: "tool-1", toolName: "bash" },
      { type: "model_working" },
    ]);
  });

  it("keeps the model run alive when the progress surface fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const reporter = createRunChatProgressReporter(async () => {
      throw new Error("Slack unavailable");
    });

    await expect(reporter.textDelta("Safe answer")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
