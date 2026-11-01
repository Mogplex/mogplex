import { expect, it, vi } from "vitest";
import { handleSlackRequestStop } from "./request-interactions";
import { installation } from "./connection-recovery/test-fixtures";
import type { SlackBlockActionsPayload } from "./interactivity";

function setup() {
  const payload = {
    type: "block_actions",
    team: { id: "T1" },
    user: { id: "U1" },
    channel: { id: "D1" },
    message: { ts: "2.1" },
    response_url: "https://hooks.slack.com/actions/test",
    actions: [{ action_id: "mogplex_stop_request", value: "run_test123" }],
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
      slackConversationalUserId: installation.installed_by_user_id,
      slackConversationalPlaceholder: {
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
      response_type: "ephemeral",
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
    run.metadata["slackConversationalUserId"] = "different-profile";
  if (variant === "other-event") run.payload.eventId = "Ev2";
  expect(await handleSlackRequestStop(payload, deps)).toBe("not_owner");
  expect(deps.cancel).not.toHaveBeenCalled();
});
it("does not overwrite a completed answer when Stop arrives late", async () => {
  const { payload, run, deps } = setup();
  run.isCompleted = true;
  expect(await handleSlackRequestStop(payload, deps)).toBe("already_finished");
  expect(deps.cancel).not.toHaveBeenCalled();
  expect(deps.respond).toHaveBeenCalledWith(payload.response_url, {
    response_type: "ephemeral",
    replace_original: false,
    text: "This request has already finished.",
  });
});
it("leaves the active status retryable when cancellation fails", async () => {
  const { payload, deps } = setup();
  deps.cancel.mockRejectedValue(new Error("Runtime unavailable"));
  await expect(handleSlackRequestStop(payload, deps)).rejects.toThrow(
    "Runtime unavailable"
  );
  expect(deps.respond).toHaveBeenCalledWith(
    payload.response_url,
    expect.objectContaining({
      response_type: "ephemeral",
      replace_original: false,
      text: expect.stringContaining("Could not stop"),
    })
  );
});
it("rejects malformed identifiers before querying the runtime", async () => {
  const { payload, deps } = setup();
  payload.actions[0].value = "bad-id";
  expect(await handleSlackRequestStop(payload, deps)).toBe("invalid");
  expect(deps.retrieve).not.toHaveBeenCalled();
});

it.each(["delivered", "failed"])(
  "does not cancel a %s answer while task persistence is finishing",
  async (state) => {
    const { payload, run, deps } = setup();
    run.metadata.slackTerminalState = state;
    expect(await handleSlackRequestStop(payload, deps)).toBe(
      "already_finished"
    );
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(deps.respond).toHaveBeenCalledWith(payload.response_url, {
      response_type: "ephemeral",
      replace_original: false,
      text: "This request has already finished.",
    });
  }
);
it.each(["active", "completed", "failure"])(
  "handles %s interactions without a response URL",
  async (mode) => {
    const { payload, run, deps } = setup();
    const { response_url: _url, ...withoutResponse } = payload;
    if (mode === "completed") run.isCompleted = true;
    if (mode === "failure")
      deps.cancel.mockRejectedValue(new Error("Unavailable"));
    if (mode === "failure")
      await expect(
        handleSlackRequestStop(withoutResponse, deps)
      ).rejects.toThrow("Unavailable");
    else
      expect(await handleSlackRequestStop(withoutResponse, deps)).toBe(
        mode === "active" ? "stop_requested" : "already_finished"
      );
    expect(deps.respond).not.toHaveBeenCalled();
  }
);
it.each(["run_", "prefix_run_test123", "run_test123/extra", "run_test_123"])(
  "rejects malformed runtime id %s",
  async (value) => {
    const { payload, deps } = setup();
    payload.actions[0].value = value;
    expect(await handleSlackRequestStop(payload, deps)).toBe("invalid");
    expect(deps.retrieve).not.toHaveBeenCalled();
  }
);
const incomplete: Partial<SlackBlockActionsPayload>[] = [
  { actions: undefined },
  { actions: [] },
  { actions: [{ action_id: "unrelated", value: "run_test123" }] },
  { actions: [{ action_id: "mogplex_stop_request" }] },
  { team: undefined },
  { user: undefined },
];
it.each(incomplete)(
  "rejects incomplete button data before reading a runtime",
  async (overrides) => {
    const { payload, deps } = setup();
    expect(
      await handleSlackRequestStop({ ...payload, ...overrides }, deps)
    ).toBe("invalid");
    expect(deps.retrieve).not.toHaveBeenCalled();
  }
);
it("uses the Stop action rather than an unrelated action in the payload", async () => {
  const { payload, deps } = setup();
  payload.actions.unshift({ action_id: "unrelated", value: "bad-id" });
  expect(await handleSlackRequestStop(payload, deps)).toBe("stop_requested");
});
it("rejects a missing installation or unlinked clicking user", async () => {
  const { payload, deps } = setup();
  expect(
    await handleSlackRequestStop(payload, {
      ...deps,
      getInstallation: async () => null,
    })
  ).toBe("unknown_workspace");
  expect(
    await handleSlackRequestStop({ ...payload, user: { id: "U2" } }, deps)
  ).toBe("not_linked");
  expect(deps.retrieve).not.toHaveBeenCalled();
});
it("resolves a non-installer's explicit mapping in the installation that owns the event", async () => {
  const { payload, run, deps } = setup();
  payload.user.id = "U2";
  run.payload.slackUserId = "U2";
  const result = await handleSlackRequestStop(payload, {
    ...deps,
    getMapping: async (input) =>
      input.installationId === installation.id && input.slackUserId === "U2"
        ? {
            id: "mapping",
            slack_installation_id: installation.id,
            slack_user_id: "U2",
            mogplex_user_id: installation.installed_by_user_id,
            slack_email: null,
            matched_at: null,
            link_status: "explicit",
            created_at: "2026-11-01",
          }
        : null,
  });
  expect(result).toBe("stop_requested");
});
it.each(["channel", "threadTs", "eventId"])(
  "refuses an inconsistent saved message %s",
  async (field) => {
    const { payload, run, deps } = setup();
    (run.metadata.slackConversationalPlaceholder as Record<string, unknown>)[
      field
    ] = "different";
    expect(await handleSlackRequestStop(payload, deps)).toBe("not_owner");
    expect(deps.cancel).not.toHaveBeenCalled();
  }
);
it("refuses a runtime channel mismatch independently of the message channel", async () => {
  const { payload, run, deps } = setup();
  run.payload.channelId = "other";
  expect(await handleSlackRequestStop(payload, deps)).toBe("not_owner");
});
it("supports Slack's container-only message identity", async () => {
  const { payload, deps } = setup();
  const { channel: _channel, message: _message, ...base } = payload;
  expect(
    await handleSlackRequestStop(
      { ...base, container: { channel_id: "D1", message_ts: "2.1" } },
      deps
    )
  ).toBe("stop_requested");
  expect(await handleSlackRequestStop(base, deps)).toBe("not_owner");
});
it.each([undefined, {}])(
  "refuses absent runtime metadata",
  async (metadata) => {
    const { payload, run, deps } = setup();
    expect(
      await handleSlackRequestStop(payload, {
        ...deps,
        retrieve: async () => ({ ...run, metadata }),
      })
    ).toBe("not_owner");
    expect(deps.cancel).not.toHaveBeenCalled();
  }
);
