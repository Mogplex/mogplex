import { expect, it, vi } from "vitest";
import { requestSlackConnectionRecovery } from "./request";
import { recoveryRequest } from "./test-fixtures";

function setup() {
  const request = recoveryRequest();
  return {
    input: {
      userId: request.user_id,
      installationId: request.slack_installation_id,
      botToken: "test-token",
      payload: request.payload,
      target: request.target,
      resumeText: request.resume_text,
    },
    deps: {
      canRecover: vi.fn(async () => true),
      saveRequest: vi.fn(async () => request),
      describe: vi.fn(async () => ({
        name: undefined,
        icon: "github",
        restoreRepository: false,
      })),
      postMessage: vi.fn(async () => ({ channel: "D1", ts: "10.3" })),
      appUrl: () => "https://mogplex.example",
    },
  };
}
it("saves the task before posting a connector card in the originating thread", async () => {
  const { input, deps } = setup();
  expect(await requestSlackConnectionRecovery(input, deps)).toMatchObject({
    ok: true,
    requestId: recoveryRequest().id,
  });
  expect(deps.saveRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: input.userId,
      target: input.target,
      payload: input.payload,
      resume_text: input.resumeText,
    })
  );
  expect(deps.postMessage).toHaveBeenCalledWith(
    "test-token",
    expect.objectContaining({
      channel: "D1",
      thread_ts: "10.1",
      blocks: expect.any(Array),
    })
  );
  expect(JSON.stringify(deps.postMessage.mock.calls)).toContain("github.png");
  expect(deps.saveRequest.mock.invocationCallOrder[0]).toBeLessThan(
    deps.postMessage.mock.invocationCallOrder[0]
  );
});
it("does not save or propose a connector when team policy denies it", async () => {
  const { input, deps } = setup();
  deps.canRecover.mockResolvedValue(false);
  expect(await requestSlackConnectionRecovery(input, deps)).toMatchObject({
    ok: false,
  });
  expect(deps.saveRequest).not.toHaveBeenCalled();
  expect(deps.postMessage).not.toHaveBeenCalled();
});
it("does not post a card when the pending task could not be saved", async () => {
  const { input, deps } = setup();
  deps.saveRequest.mockRejectedValue(new Error("Save failed"));
  await expect(requestSlackConnectionRecovery(input, deps)).rejects.toThrow(
    "Save failed"
  );
  expect(deps.postMessage).not.toHaveBeenCalled();
});
it("does not reveal or authorize another user's connection", async () => {
  const { input, deps } = setup();
  expect(
    await requestSlackConnectionRecovery(
      {
        ...input,
        target: {
          provider: "connection",
          connectionId: "00000000-0000-4000-8000-000000000099",
        },
      },
      deps
    )
  ).toEqual({ ok: false, error: "Connection not found in your account." });
  expect(deps.postMessage).not.toHaveBeenCalled();
});
