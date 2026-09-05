import { expect, it } from "vitest";
import type { UIMessage } from "ai";
import { createControlApprovalSubmission } from "./approval-submission";

const message = (
  state: "approval-requested" | "approval-responded"
): UIMessage => ({
  id: "m",
  role: "assistant",
  parts: [
    {
      type: "tool-action",
      toolCallId: "a",
      input: {},
      ...(state === "approval-requested"
        ? { state, approval: { id: "a" } }
        : { state, approval: { id: "a", approved: true } }),
    },
    { type: "step-start" },
    { type: "text", text: "Another action completed" },
  ],
});

it("submits an explicit older-step decision once, never on reload or stream completion alone", () => {
  const submission = createControlApprovalSubmission();
  const pending = message("approval-requested");
  const responded = message("approval-responded");
  expect(submission.shouldSubmit({ messages: [responded] })).toBe(false);
  submission.request([pending], "wrong");
  expect(submission.shouldSubmit({ messages: [responded] })).toBe(false);
  submission.request([pending], "a");
  expect(submission.shouldSubmit({ messages: [pending] })).toBe(false);
  expect(submission.shouldSubmit({ messages: [responded] })).toBe(true);
  expect(submission.shouldSubmit({ messages: [responded] })).toBe(false);
  submission.request([responded], "a");
  expect(submission.shouldSubmit({ messages: [responded] })).toBe(false);
  submission.request([], "a");
  expect(submission.shouldSubmit({ messages: [] })).toBe(false);
  expect(
    submission.shouldSubmit({ messages: [{ ...responded, role: "user" }] })
  ).toBe(false);
});

it("waits for the other approval choices before submitting the batch", () => {
  const submission = createControlApprovalSubmission();
  const pending = message("approval-requested");
  const other = {
    ...pending.parts[0],
    toolCallId: "b",
    approval: { id: "b" },
  } as UIMessage["parts"][number];
  const batch = { ...pending, parts: [...pending.parts, other] };
  submission.request([batch], "a");
  const partial = {
    ...batch,
    parts: [...message("approval-responded").parts, other],
  };
  expect(submission.shouldSubmit({ messages: [partial] })).toBe(false);
  submission.request([partial], "b");
  const finished = {
    ...partial,
    parts: [
      ...message("approval-responded").parts,
      {
        ...other,
        state: "approval-responded",
        approval: { id: "b", approved: false },
      },
    ],
  } as UIMessage;
  expect(submission.shouldSubmit({ messages: [finished] })).toBe(true);
  expect(submission.shouldSubmit({ messages: [finished] })).toBe(false);
});
