import { expect, it, vi } from "vitest";
import { resolveConnectionRecoveryBrowser } from "./browser";
import { installation, recoveryRequest } from "./test-fixtures";

function setup() {
  const request = recoveryRequest();
  return {
    request,
    input: { userId: request.user_id, requestId: request.id },
    deps: {
      getInstallation: async () => installation,
      getMapping: async () => null,
      loadRequest: async () => request,
      canRecover: vi.fn(async () => true),
      authorizePath: vi.fn(async () => "/api/auth/github?next=return"),
    },
  };
}
it("continues through the provider only for the currently linked requester", async () => {
  const { input, deps } = setup();
  expect(await resolveConnectionRecoveryBrowser(input, deps)).toEqual({
    authorizePath: "/api/auth/github?next=return",
    slackUrl: "https://slack.com/app_redirect?team=T1&channel=D1",
  });
});
it.each(["account", "installation", "mapping", "capability"])(
  "blocks a revoked or different %s before generating an authorization URL",
  async (kind) => {
    const { request, input, deps } = setup();
    if (kind === "account") input.userId = "other";
    if (kind === "installation") request.slack_installation_id = "other";
    if (kind === "mapping") request.payload.slackUserId = "other";
    if (kind === "capability") deps.canRecover.mockResolvedValue(false);
    expect(await resolveConnectionRecoveryBrowser(input, deps)).toBeNull();
    expect(deps.authorizePath).not.toHaveBeenCalled();
  }
);
