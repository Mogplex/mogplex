import type { UIMessage } from "ai";
import { expect, it } from "vitest";
import { controlRequestHistory } from "./request-history";
import { mergePersistedControlMessages } from "./transcript-store";

const user: UIMessage = {
  id: "user",
  role: "user",
  parts: [{ type: "text", text: "Do it" }],
};
const assistant: UIMessage = {
  id: "assistant",
  role: "assistant",
  parts: [
    {
      type: "tool-git_push",
      toolCallId: "call",
      state: "approval-requested",
      input: { branch: "feature" },
      approval: { id: "approval" },
    },
  ],
};

it("older browser snapshots cannot drop or replace saved replies", () => {
  const newer: UIMessage = {
    id: "background",
    role: "assistant",
    parts: [{ type: "text", text: "Worker finished" }],
  };
  const merged = mergePersistedControlMessages(
    [user, assistant, newer],
    [user, { ...assistant, parts: [] }, { ...user, id: "followup" }]
  );
  expect(merged).toEqual([user, assistant, newer, { ...user, id: "followup" }]);
  expect(mergePersistedControlMessages(merged, [])).toEqual(merged);
  expect(mergePersistedControlMessages(merged, [user, user])).toEqual(merged);
});

it("accepts the matching approval decision without trusting edited tool inputs", () => {
  const submitted: UIMessage = {
    ...assistant,
    parts: [
      {
        type: "tool-git_push",
        toolCallId: "call",
        state: "approval-responded",
        input: { branch: "main" },
        approval: { id: "approval", approved: true },
      },
    ],
  };
  expect(
    controlRequestHistory([user, assistant], [submitted])[1].parts[0]
  ).toMatchObject({
    state: "approval-responded",
    input: { branch: "feature" },
    approval: { approved: true },
  });
  const wrong: UIMessage = {
    ...assistant,
    parts: [
      {
        type: "tool-git_push",
        toolCallId: "call",
        state: "approval-responded",
        input: {},
        approval: { id: "other", approved: true },
      },
    ],
  };
  expect(controlRequestHistory([assistant], [wrong])).toEqual([assistant]);
  expect(
    controlRequestHistory([assistant], [{ ...submitted, role: "user" }])
  ).toEqual([assistant]);
});
