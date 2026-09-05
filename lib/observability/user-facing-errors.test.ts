import { expect, it } from "vitest";
import {
  presentObservabilityFailure,
  sanitizeObservabilityEvent,
  sanitizeObservabilityPayload,
  sanitizeObservabilityToolEntry,
} from "./user-facing-errors";

it.each(["", " \n\t"])(
  "preserves blank diagnostics %j without inventing a failure",
  (blank) => {
    const output = { exitCode: 0, stdout: "command completed", stderr: blank };
    const tool = { id: "tool-1", state: "success", output };
    expect(sanitizeObservabilityToolEntry(tool)).toEqual(tool);
    const call = {
      id: "call-1",
      status: "success",
      error: blank,
      tool_calls: [tool],
    };
    expect(sanitizeObservabilityPayload(call, "CALL", call.id)).toEqual(call);
    const event = {
      id: "event-1",
      event_type: "tool_finished",
      data: { output },
    };
    expect(sanitizeObservabilityEvent(event)).toEqual(event);
  }
);

it("preserves empty diagnostics without hiding an actual failed state", () => {
  const call = {
    id: "call-1",
    status: "failed",
    error: "",
    metadata: { detail: "" },
  };
  expect(sanitizeObservabilityPayload(call, "CALL", call.id)).toEqual(call);
  expect(presentObservabilityFailure("", "MOG-CALL-1")).toMatch(
    /internal service error/
  );
  expect(
    sanitizeObservabilityEvent({
      id: "event-1",
      event_type: "failed",
      message: "",
    }).message
  ).toMatch(/internal service error/);
});

it("still redacts nonempty internal diagnostics even when command exit code is zero", () => {
  const raw =
    "DATABASE_PASSWORD is required at http://worker.internal:8080/run";
  const tool = {
    id: "tool-1",
    state: "success",
    output: { exitCode: 0, stdout: "ok", stderr: raw },
  };
  const result = sanitizeObservabilityToolEntry(tool);
  expect(result.output.exitCode).toBe(0);
  expect(result.output.stdout).toBe("ok");
  expect(result.output.stderr).toMatch(/configuration/);
  expect(JSON.stringify(result)).not.toContain("DATABASE_PASSWORD");
  expect(JSON.stringify(result)).not.toContain("worker.internal");
  expect(tool.output.stderr).toBe(raw);
});
