import type { UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import {
  controlRequestHistory,
  prepareControlRequestHistory,
  controlMessagesForModel,
} from "./request-history";
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

it("requires a successful database claim before returning an executable approval response", async () => {
  const submitted: UIMessage = {
    ...assistant,
    parts: [
      {
        type: "tool-git_push",
        toolCallId: "call",
        state: "approval-responded",
        input: { branch: "main" },
        approval: { id: "approval", approved: false },
      },
    ],
  };
  const input = {
    userId: "owner",
    sessionId: "session",
    aiCallId: "call",
    savedMessages: [user, assistant],
    incomingMessages: [user, submitted],
  };
  const database = (body: unknown, status = 200) =>
    createClient("https://db.example.test", "fixture", {
      auth: { persistSession: false },
      global: { fetch: async () => Response.json(body, { status }) },
    });
  const result = await prepareControlRequestHistory(input, database(true));
  await expect(result.complete!()).resolves.toBeUndefined();
  let databaseResponse = true;
  let databaseStatus = 200;
  const changingDatabase = createClient("https://db.example.test", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: async () =>
        Response.json(databaseResponse, { status: databaseStatus }),
    },
  });
  const releasable = await prepareControlRequestHistory(
    input,
    changingDatabase
  );
  databaseResponse = false;
  await expect(releasable.complete!()).rejects.toThrow("Could not finish");
  databaseStatus = 500;
  await expect(releasable.complete!()).rejects.toThrow("Could not finish");
  const modelMessages = controlMessagesForModel(
    result.messages,
    result.claimedApprovalIds
  );
  expect(modelMessages[1].parts.at(-1)).toEqual(result.messages[1].parts[0]);
  expect(modelMessages[1].parts[0]).toEqual({ type: "step-start" });
  expect(JSON.stringify(controlMessagesForModel(result.messages))).toContain(
    "no recorded result"
  );
  expect(JSON.stringify(controlMessagesForModel([assistant]))).toContain(
    "no recorded result"
  );
  expect(assistant.parts[0].type).toBe("tool-git_push");
  expect(result.continuationMessageId).toBe(assistant.id);
  expect(result.messages[1].parts[0]).toMatchObject({
    input: { branch: "feature" },
    approval: { approved: false },
  });
  await expect(
    prepareControlRequestHistory(input, database(false))
  ).rejects.toThrow("already submitted");
  await expect(
    prepareControlRequestHistory(
      input,
      database({ message: "Private database diagnostic" }, 500)
    )
  ).rejects.toThrow("No approved action was started");
  await expect(
    prepareControlRequestHistory(
      { ...input, savedMessages: [] },
      database(true)
    )
  ).rejects.toThrow("already submitted");
  await expect(
    prepareControlRequestHistory(
      { ...input, savedMessages: [submitted] },
      database(true)
    )
  ).rejects.toThrow("already submitted");
  expect(
    (
      await prepareControlRequestHistory(
        { ...input, incomingMessages: [user] },
        database(false)
      )
    ).continuationMessageId
  ).toBeUndefined();
  expect(controlRequestHistory([assistant], [submitted, user])).toEqual([
    assistant,
  ]);
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
