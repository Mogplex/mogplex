import { expect, it } from "vitest";
import type { AiCallEvent } from "@/lib/types";
import { agentTerminalEntries } from "./agent-activity";

const event = (
  id: string,
  type: AiCallEvent["event_type"],
  payload: Record<string, unknown>
): AiCallEvent => ({
  id,
  event_type: type,
  ai_call_id: "call",
  user_id: "owner",
  conversation_id: null,
  repo_id: "repo",
  tool_name: "bash",
  message: null,
  payload,
  created_at: "2026-10-10T12:00:00Z",
});

it("combines native start/finish pairs and preserves recorded output beyond the Control preview", () => {
  const lines = Array.from({ length: 12 }, (_, n) => `output ${n}`);
  const events = [
    event("start", "tool_started", {
      tool_call_id: "cmd",
      input: { command: "pnpm build" },
    }),
    event("finish", "tool_finished", {
      tool_call_id: "cmd",
      output: { stdout: lines.join("\n"), exitCode: 0 },
      success: true,
    }),
  ];
  const entries = agentTerminalEntries("call", "success", [
    ...events,
    events[1],
    { ...events[0], id: "foreign", ai_call_id: "other" },
  ]);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    command: "pnpm build",
    state: "done",
    lines,
  });
});
it("renders running, failed, and interrupted commands truthfully across native and harness events", () => {
  const start = event("start", "tool_started", {
    toolCallId: "cmd",
    input: { command: "pnpm test" },
  });
  expect(agentTerminalEntries("call", "streaming", [start])[0].state).toBe(
    "running"
  );
  expect(agentTerminalEntries("call", "cancelled", [start])[0]).toMatchObject({
    state: "failed",
    lines: ["No completion result was received before the run stopped."],
  });
  const fail = event("end", "tool_finished", {
    toolCallId: "cmd",
    success: false,
    error: "Command unavailable",
  });
  expect(
    agentTerminalEntries("call", "failed", [start, fail])[0]
  ).toMatchObject({ state: "failed", lines: ["Command unavailable"] });
  const exit = event("end", "tool_finished", {
    toolCallId: "cmd",
    output: { stdout: "Test failed", exitCode: 1 },
  });
  expect(agentTerminalEntries("call", "success", [start, exit])[0].state).toBe(
    "failed"
  );
});
