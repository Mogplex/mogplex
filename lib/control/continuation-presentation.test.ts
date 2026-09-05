import { expect, it } from "vitest";
import {
  controlContinuationSummary,
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
    presentControlContinuation({ ...ticket, status: "running" })
  ).toMatchObject({
    label: "Coordinator is reviewing the results",
    cancelable: true,
    retryable: false,
    attention: false,
  });
});

it.each([
  ["waiting", "Waiting for workers", /resume here automatically/, false],
  ["ready", "Coordinator follow-up queued", /No new prompt is needed/, false],
  [
    "running",
    "Coordinator is reviewing the results",
    /as they are saved/,
    false,
  ],
  [
    "finished",
    "Coordinator reply saved",
    /does not mean the mission is complete/,
    false,
  ],
  [
    "needs_input",
    "Your approval is needed",
    /Review the requested action/,
    true,
  ],
  [
    "failed",
    "Coordinator follow-up stopped",
    /saved conversation and worker output remain available/,
    true,
  ],
  [
    "cancelled",
    "Coordinator follow-up cancelled",
    /Workers and sandbox are unchanged/,
    false,
  ],
] as const)(
  "explains %s without losing its recovery guidance",
  (status, label, description, attention) => {
    const presentation = presentControlContinuation({ ...ticket, status });
    expect(presentation.label).toBe(label);
    expect(presentation.description).toMatch(description);
    expect(presentation.attention).toBe(attention);
  }
);

it.each([
  "waiting",
  "running",
  "finished",
  "needs_input",
  "failed",
  "cancelled",
] as const)(
  "never offers delivery retry for %s even when an error is recorded",
  (status) => {
    expect(
      presentControlContinuation({
        ...ticket,
        status,
        error: "Saved failure detail",
      })
    ).toMatchObject({
      description: "Saved failure detail",
      attention: true,
      retryable: false,
    });
  }
);

it("returns only public summary fields, not the coordinator request context", () => {
  const stored = {
    ...ticket,
    request_context: { messages: ["Private request context"] },
  };
  expect(controlContinuationSummary(stored)).toEqual(ticket);
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
