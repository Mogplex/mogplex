import { describe, expect, it, vi } from "vitest";
import {
  handleConnectionRecoveryAction,
  isConnectionRecoveryAction,
} from "./interactions";
import {
  CONNECTION_OPEN_ACTION,
  CONNECTION_RESTORE_ACTION,
  CONNECTION_SCOPE_ACTION,
} from "./presentation";
import { installation, recoveryAction, recoveryRequest } from "./test-fixtures";

function setup() {
  const request = recoveryRequest();
  const deps = {
    getInstallation: async () => installation,
    getUserMapping: async () => null,
    getBotToken: async () => "test-bot-token",
    loadRequest: vi.fn(async () => request),
    markDispatched: vi.fn(async () => {
      request.dispatched_at = "2026-10-10";
    }),
    checkAccess: vi.fn(async () => ({
      ready: true,
      message: "Access checked",
    })),
    describe: vi.fn(async () => ({
      name: undefined,
      icon: "github",
      restoreRepository: false,
    })),
    restoreRepository: vi.fn(async () => {}),
    repairScope: vi.fn(async () => {}),
    openView: vi.fn(async () => ({ ok: true, view: { id: "V1" } })),
    updateView: vi.fn(async () => ({ ok: true, view: { id: "V1" } })),
    postEphemeral: vi.fn(async () => ({ message_ts: "10.3" })),
    dispatch: vi.fn(async () => {}),
    appUrl: () => "https://mogplex.example",
  };
  return { request, deps };
}

describe("Slack connection modal actions", () => {
  it("opens a native modal on the connector button without waiting for a provider check", async () => {
    const { deps } = setup();
    const payload = {
      ...recoveryAction(CONNECTION_OPEN_ACTION),
      view: undefined,
      channel: { id: "D1" },
    };
    expect(isConnectionRecoveryAction(payload)).toBe(true);
    expect(await handleConnectionRecoveryAction(payload, deps)).toBe("opened");
    expect(deps.openView).toHaveBeenCalledWith(
      "test-bot-token",
      expect.objectContaining({
        trigger_id: "trigger",
        view: expect.objectContaining({
          type: "modal",
          private_metadata: recoveryRequest().id,
        }),
      })
    );
    expect(deps.checkAccess).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.openView.mock.invocationCallOrder[0]).toBeLessThan(
      deps.describe.mock.invocationCallOrder[0]
    );
  });
  it("repairs scope only on the explicit confirmed action, then checks access again", async () => {
    const { deps } = setup();
    expect(
      await handleConnectionRecoveryAction(
        recoveryAction(CONNECTION_SCOPE_ACTION),
        deps
      )
    ).toBe("dispatched");
    expect(deps.repairScope).toHaveBeenCalledOnce();
    expect(deps.repairScope.mock.invocationCallOrder[0]).toBeLessThan(
      deps.checkAccess.mock.invocationCallOrder[0]
    );
  });
  it("checks grants before resuming the saved task once in its original thread", async () => {
    const { deps } = setup();
    expect(await handleConnectionRecoveryAction(recoveryAction(), deps)).toBe(
      "dispatched"
    );
    expect(deps.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "D1",
        threadTs: "10.1",
        slackUserId: "U1",
        eventId: `slack-connection:${recoveryRequest().id}`,
        text: expect.stringContaining("Fix acme/widgets and open a PR."),
      })
    );
    expect(await handleConnectionRecoveryAction(recoveryAction(), deps)).toBe(
      "already_dispatched"
    );
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.restoreRepository).not.toHaveBeenCalled();
  });
  it("keeps the task paused when authorization is still missing", async () => {
    const { deps } = setup();
    deps.checkAccess.mockResolvedValue({
      ready: false,
      message: "Authorize the repository",
    });
    expect(await handleConnectionRecoveryAction(recoveryAction(), deps)).toBe(
      "needs_authorization"
    );
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(deps.updateView.mock.calls)).toContain(
      "Authorize the repository"
    );
  });
  it("only restores a hidden repository after the explicit restore action", async () => {
    const { deps } = setup();
    expect(
      await handleConnectionRecoveryAction(
        recoveryAction(CONNECTION_RESTORE_ACTION),
        deps
      )
    ).toBe("dispatched");
    expect(deps.restoreRepository).toHaveBeenCalledWith(
      expect.objectContaining({ id: recoveryRequest().id })
    );
    expect(deps.checkAccess).toHaveBeenCalledTimes(1);
  });
  it("shows a retry message without losing the task if dispatch fails", async () => {
    const { deps } = setup();
    deps.dispatch.mockRejectedValue(new Error("Internal delivery details"));
    expect(await handleConnectionRecoveryAction(recoveryAction(), deps)).toBe(
      "retry"
    );
    expect(deps.markDispatched).not.toHaveBeenCalled();
    expect(JSON.stringify(deps.updateView.mock.calls)).toContain("Try again");
    expect(JSON.stringify(deps.updateView.mock.calls)).not.toContain(
      "Internal delivery details"
    );
  });
  it.each(["user", "team", "channel", "metadata", "installation"])(
    "rejects mismatched %s identity without dispatching",
    async (kind) => {
      const { deps, request } = setup();
      const payload = recoveryAction();
      if (kind === "user") payload.user = { id: "STRANGER" };
      if (kind === "team") payload.team = { id: "T2" };
      if (kind === "channel") payload.channel = { id: "D2" };
      if (kind === "metadata") payload.view!.private_metadata = "other-request";
      if (kind === "installation")
        request.slack_installation_id = "other-installation";
      expect(await handleConnectionRecoveryAction(payload, deps)).toMatch(
        /not_owner|not_linked/
      );
      expect(deps.dispatch).not.toHaveBeenCalled();
      expect(deps.checkAccess).not.toHaveBeenCalled();
      expect(deps.restoreRepository).not.toHaveBeenCalled();
    }
  );
  it("ignores malformed requests and unrelated actions", async () => {
    const { deps } = setup();
    expect(
      isConnectionRecoveryAction({ type: "block_actions", actions: [] })
    ).toBe(false);
    expect(
      await handleConnectionRecoveryAction(
        {
          ...recoveryAction(),
          actions: [{ action_id: CONNECTION_OPEN_ACTION, value: "bad" }],
        },
        deps
      )
    ).toBe("invalid");
    expect(deps.loadRequest).not.toHaveBeenCalled();
  });
});
