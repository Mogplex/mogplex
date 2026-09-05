import { expect, it } from "vitest";
import type { PresentedAiCallEvent } from "@/lib/mogplex-api/run-control";
import { projectRunTranscript } from "./transcript";

const event = (
  id: string,
  type: PresentedAiCallEvent["type"],
  message: string,
  payload = {}
): PresentedAiCallEvent => ({
  id,
  type,
  message,
  payload,
  toolName: "bash",
  createdAt: "",
});

it("reconstructs ordered chat and tools without duplicate events or final text", () => {
  const start = event("2", "tool_started", "bash started", { toolCallId: "t" });
  const events = [
    event("1", "log", "Checking", { kind: "assistant_delta" }),
    start,
    start,
    event("3", "tool_finished", "bash finished", {
      toolCallId: "t",
      state: "success",
    }),
    event("4", "log", "Fixed", { kind: "assistant_final" }),
    event("5", "log", "Fixed", { kind: "assistant_delta" }),
  ];
  const messages = projectRunTranscript("r", "Fix mobile", events, "success");
  expect(messages[0].parts).toEqual([{ type: "text", text: "Fix mobile" }]);
  expect(messages[1].parts).toEqual([
    { type: "text", text: "Checking" },
    {
      type: "dynamic-tool",
      toolName: "bash",
      toolCallId: "t",
      state: "output-available",
      input: {},
      output: "Command finished. Detailed output was not recorded.",
    },
    { type: "text", text: "Fixed" },
  ]);
});

it.each(["success", "failed", "cancelled"])(
  "does not leave an unfinished tool running after a %s run",
  (status) => {
    const messages = projectRunTranscript(
      "r",
      "Fix",
      [event("1", "tool_started", "", { toolCallId: "t" })],
      status
    );
    expect(messages[1].parts[0]).toMatchObject({
      state: "output-error",
      errorText: expect.stringContaining("No completion result"),
    });
  }
);

it("keeps an awaiting-input tool resumable rather than marking it failed", () => {
  const start = event("1", "tool_started", "", { toolCallId: "t" });
  const paused = projectRunTranscript("r", "Fix", [start], "awaiting_input");
  expect(paused[1].parts[0]).toMatchObject({ state: "input-available" });
  expect(paused[1].parts[0]).not.toHaveProperty("errorText");
  const resumed = projectRunTranscript(
    "r",
    "Fix",
    [
      start,
      event("2", "tool_finished", "", { toolCallId: "t", state: "success" }),
    ],
    "success"
  );
  expect(resumed[1].parts[0]).toMatchObject({ state: "output-available" });
});

it("does not report a denied harness tool as successful", () => {
  const messages = projectRunTranscript(
    "r",
    "Fix",
    [event("1", "tool_finished", "", { toolCallId: "t", state: "denied" })],
    "success"
  );
  expect(messages[1].parts[0]).toMatchObject({ state: "output-error" });
});

it("keeps running tools open and supports final-only history without exposing unrelated logs", () => {
  const messages = projectRunTranscript(
    "r",
    "Fix",
    [
      event("1", "log", "internal"),
      event("2", "log", "Done", { kind: "assistant_final" }),
      event("3", "tool_started", "", {}),
    ],
    "streaming"
  );
  expect(messages[1].parts[0]).toMatchObject({
    toolCallId: "3",
    state: "input-available",
  });
  expect(messages[1].parts[1]).toEqual({ type: "text", text: "Done" });
  expect(JSON.stringify(messages)).not.toContain("internal");
});
