import { expect, it } from "vitest";
import type { PresentedAiCallEvent } from "@/lib/mogplex-api/run-control";
import { projectRunTranscript } from "./transcript";
import {
  CHECKPOINT_MARKER_START as start,
  CHECKPOINT_MARKER_END as end,
} from "@/lib/harness/checkpoint";

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

it("shows the readable plan once and hides checkpoint transport in saved history", () => {
  const output = `## Plan\n\n- Preserve desktop.\n\n${start}\n${JSON.stringify({ kind: "plan", summary: "Preserve desktop." })}\n${end}`;
  const events = [
    event("1", "log", output, { kind: "assistant_delta" }),
    event("2", "log", output, { kind: "assistant_final" }),
  ];
  const messages = projectRunTranscript("r", "Fix", events, "awaiting_input");
  expect(messages[1].parts).toEqual([
    { type: "text", text: "## Plan\n\n- Preserve desktop." },
  ]);
  expect(events[0].message).toBe(output);
});

it("renders checkpoint-only output as readable markdown, not JSON", () => {
  const output = `${start}\n${JSON.stringify({ summary: "## Changes\n\n- Fixed mobile.\n- Tests passed." })}\n${end}`;
  expect(
    projectRunTranscript(
      "r",
      "Fix",
      [event("1", "log", output, { kind: "assistant_final" })],
      "awaiting_input"
    )[1].parts
  ).toEqual([
    { type: "text", text: "## Changes\n\n- Fixed mobile.\n- Tests passed." },
  ]);
});

it("never flashes partial checkpoint markers or JSON while deltas arrive", () => {
  const output = `Ready.\n\n${start}{"summary":"Ready."}${end}`;
  for (let i = output.indexOf("<"); i <= output.length; i++) {
    const events = Array.from(output.slice(0, i), (char, index) =>
      event(String(index), "log", char, { kind: "assistant_delta" })
    );
    const parts = projectRunTranscript("r", "Fix", events, "streaming")[1]
      .parts;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "text", text: expect.any(String) });
    expect((parts[0] as { text: string }).text.trim()).toBe("Ready.");
  }
});

it("keeps ordinary assistant whitespace and trailing punctuation unchanged", () => {
  const output = "    indented example\n\nUse x <";
  expect(
    projectRunTranscript(
      "r",
      "Fix",
      [event("1", "log", output, { kind: "assistant_final" })],
      "success"
    )[1].parts
  ).toEqual([{ type: "text", text: output }]);
});

it("keeps multiple checkpoint summaries readable and suppresses empty or unfinished protocol-only output", () => {
  const first = `${start}{"summary":"First plan"}${end}`;
  const second = `${start}{"summary":"Updated plan"}${end}`;
  expect(
    projectRunTranscript(
      "r",
      "Fix",
      [event("1", "log", first + second, { kind: "assistant_final" })],
      "awaiting_input"
    )[1].parts
  ).toEqual([{ type: "text", text: "First plan\n\nUpdated plan" }]);
  for (const output of [
    start,
    `${start}{"summary":`,
    `${start}{}${end}`,
    `${start}{bad}${end}`,
  ]) {
    expect(
      projectRunTranscript(
        "r",
        "Fix",
        [event("1", "log", output, { kind: "assistant_delta" })],
        "streaming"
      )
    ).toHaveLength(1);
  }
});

it("hides malformed checkpoint transport and preserves literal tool output and the user request", () => {
  const output = `Plan above.\n${start}{bad json}${end}\nMore context.`;
  const messages = projectRunTranscript(
    "r",
    start,
    [
      event("1", "log", output, { kind: "assistant_final" }),
      event("2", "tool_finished", "", { toolCallId: "t", output: start }),
    ],
    "success"
  );
  expect(messages[0].parts).toEqual([{ type: "text", text: start }]);
  expect(messages[1].parts).toEqual([
    expect.objectContaining({ output: start }),
    { type: "text", text: "Plan above.\n\nMore context." },
  ]);
});

it("restores worker commands and output after reconnecting", () => {
  const messages = projectRunTranscript(
    "r",
    "Fix",
    [
      event("1", "tool_started", "", {
        toolCallId: "t",
        input: { command: "pnpm test" },
      }),
      event("2", "tool_finished", "", {
        toolCallId: "t",
        state: "done",
        output: { output: "3 tests passed", exit_code: 0 },
      }),
    ],
    "success"
  );
  expect(messages[1].parts[0]).toMatchObject({
    input: { command: "pnpm test" },
    output: { output: "3 tests passed", exit_code: 0 },
  });
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
