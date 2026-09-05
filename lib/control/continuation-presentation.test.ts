import { expect, it } from "vitest";
import {
  presentControlContinuation,
  type ControlContinuationSummary,
} from "./continuation-presentation";

const ticket: ControlContinuationSummary = {
  id: "ticket",
  status: "waiting",
  parent_ready: true,
  error: null,
  updated_at: "now",
  worker_run_ids: ["worker"],
};
it("distinguishes waiting, queued and active follow-up without claiming mission completion", () => {
  expect(presentControlContinuation(ticket)).toMatchObject({
    label: "Waiting for workers",
    cancelable: true,
    retryable: false,
  });
  expect(
    presentControlContinuation({ ...ticket, parent_ready: false }).label
  ).toBe("Saving the coordinator handoff");
  expect(
    presentControlContinuation({ ...ticket, status: "ready" })
  ).toMatchObject({
    label: "Coordinator follow-up queued",
    cancelable: true,
    retryable: false,
  });
  expect(
    presentControlContinuation({
      ...ticket,
      status: "ready",
      error: "Queue unavailable",
    })
  ).toMatchObject({
    label: "Follow-up could not start",
    description: "Queue unavailable",
    cancelable: true,
    retryable: true,
    attention: true,
  });
  expect(
    presentControlContinuation({ ...ticket, status: "running" }).label
  ).toBe("Coordinator is reviewing the results");
});
it("does not offer replay for failed or completed execution", () => {
  for (const status of [
    "finished",
    "needs_input",
    "failed",
    "cancelled",
  ] as const)
    expect(presentControlContinuation({ ...ticket, status })).toMatchObject({
      cancelable: false,
      retryable: false,
    });
  expect(
    presentControlContinuation({ ...ticket, status: "finished" }).description
  ).toContain("does not mean the mission is complete");
  expect(
    presentControlContinuation({ ...ticket, status: "needs_input" }).attention
  ).toBe(true);
  expect(
    presentControlContinuation({ ...ticket, status: "failed" }).attention
  ).toBe(true);
});
