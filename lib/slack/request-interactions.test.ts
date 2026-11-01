import { expect, it, vi } from "vitest";
import { handleSlackRequestStop } from "./request-interactions";
import { installation } from "./connection-recovery/test-fixtures";
import {
  SLACK_REQUEST_MESSAGE_KEY,
  SLACK_REQUEST_OWNER_KEY,
  SLACK_STOP_REQUEST_ACTION,
} from "./request-presentation";

function setup() {
  const payload = {
    type: "block_actions",
    team: { id: "T1" },
    user: { id: "U1" },
    channel: { id: "D1" },
    message: { ts: "2.1" },
    response_url: "https://hooks.slack.com/actions/test",
    actions: [{ action_id: SLACK_STOP_REQUEST_ACTION, value: "run_test123" }],
  };
  const run = {
    taskIdentifier: "handle-slack-event",
    isCompleted: false,
    payload: {
      teamId: "T1",
      channelId: "D1",
      slackUserId: "U1",
      eventId: "Ev1",
      threadTs: "1.1",
    },
    metadata: {
      [SLACK_REQUEST_OWNER_KEY]: installation.installed_by_user_id,
      [SLACK_REQUEST_MESSAGE_KEY]: {
        channel: "D1",
        ts: "2.1",
        eventId: "Ev1",
        threadTs: "1.1",
      },
    } as Record<string, unknown>,
  };
  const deps = {
    getInstallation: async () => installation,
    getMapping: async () => null,
    retrieve: vi.fn(async () => run),
    cancel: vi.fn(async () => {}),
    respond: vi.fn(async () => {}),
  };
  return { payload, run, deps };
}
it("stops the exact active request owned by the clicking user", async () => {
  const { payload, deps } = setup();
  expect(await handleSlackRequestStop(payload, deps)).toBe("stop_requested");
  expect(deps.cancel).toHaveBeenCalledWith("run_test123");
  expect(deps.respond).toHaveBeenCalledWith(
    payload.response_url,
    expect.objectContaining({
      text: "Stopping your request…",
      replace_original: false,
    })
  );
});
it.each([
  "other-user",
  "other-team",
  "other-channel",
  "other-message",
  "other-task",
  "remapped-owner",
  "other-event",
])("refuses a %s request", async (variant) => {
  const { payload, run, deps } = setup();
  if (variant === "other-user") run.payload.slackUserId = "U2";
  if (variant === "other-team") run.payload.teamId = "T2";
  if (variant === "other-channel") payload.channel.id = "D2";
  if (variant === "other-message") payload.message.ts = "3.1";
  if (variant === "other-task") run.taskIdentifier = "external-agent-run";
  if (variant === "remapped-owner")
    run.metadata[SLACK_REQUEST_OWNER_KEY] = "different-profile";
  if (variant === "other-event") run.payload.eventId = "Ev2";
  expect(await handleSlackRequestStop(payload, deps)).toBe("not_owner");
  expect(deps.cancel).not.toHaveBeenCalled();
});
it("does not overwrite a completed answer when Stop arrives late", async () => {
  const { payload, run, deps } = setup();
  run.isCompleted = true;
  expect(await handleSlackRequestStop(payload, deps)).toBe("already_finished");
  expect(deps.cancel).not.toHaveBeenCalled();
});
it("leaves the active status retryable when cancellation fails", async () => {
  const { payload, deps } = setup();
  deps.cancel.mockRejectedValue(new Error("Runtime unavailable"));
  await expect(handleSlackRequestStop(payload, deps)).rejects.toThrow(
    "Runtime unavailable"
  );
  expect(deps.respond).toHaveBeenCalledWith(
    payload.response_url,
    expect.objectContaining({ text: expect.stringContaining("Could not stop") })
  );
});
it("rejects malformed identifiers before querying the runtime", async () => {
  const { payload, deps } = setup();
  payload.actions[0].value = "bad-id";
  expect(await handleSlackRequestStop(payload, deps)).toBe("invalid");
  expect(deps.retrieve).not.toHaveBeenCalled();
});
