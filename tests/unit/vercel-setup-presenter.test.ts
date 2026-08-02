import assert from "node:assert/strict";
import test from "node:test";
import { presentVercelSetup } from "../../lib/activation/setup-state";
import type { VercelCapability } from "../../lib/vercel/capabilities";

function capability(
  overrides: Partial<VercelCapability> = {}
): VercelCapability {
  return {
    platformState: "ready",
    personalState: "not_linked",
    linkedProjectState: "none",
    canUsePlatformOps: true,
    canLinkUserBillingProject: false,
    canUseUserBilling: false,
    statusLabel: "Platform ready",
    statusDetail: "",
    ...overrides,
  };
}

test("presentVercelSetup: platform-billed users skip the connect prompt", () => {
  const result = presentVercelSetup({
    vercel: capability(),
    platform_access: { allowPlatformSandbox: true, allowPlatformAi: true },
  });

  assert.equal(result.state, "platform_billed");
  assert.equal(result.canLaunchSandbox, true);
  assert.equal(result.primaryAction, null);
});

test("presentVercelSetup: fully linked users see no action", () => {
  const result = presentVercelSetup({
    vercel: capability({
      personalState: "linked",
      linkedProjectState: "workspace",
      canLinkUserBillingProject: true,
      canUseUserBilling: true,
    }),
  });

  assert.equal(result.state, "linked");
  assert.equal(result.canLaunchSandbox, true);
  assert.equal(result.primaryAction, null);
});

test("presentVercelSetup: oauth-connected without project prompts to select one", () => {
  const result = presentVercelSetup({
    vercel: capability({
      personalState: "linked",
      linkedProjectState: "none",
      canLinkUserBillingProject: true,
      canUseUserBilling: false,
    }),
  });

  assert.equal(result.state, "oauth_connected_needs_project");
  assert.equal(result.canLaunchSandbox, false);
  assert.deepEqual(result.primaryAction, {
    kind: "link_project",
    label: "Create project with Vercel billing",
    href: "/api/auth/vercel",
  });
});

test("presentVercelSetup: account default counts as fully linked", () => {
  const result = presentVercelSetup({
    vercel: capability({
      personalState: "linked",
      linkedProjectState: "account",
      canLinkUserBillingProject: true,
      canUseUserBilling: true,
    }),
  });

  assert.equal(result.state, "linked");
  assert.equal(result.canLaunchSandbox, true);
  assert.equal(result.primaryAction, null);
});

test("presentVercelSetup: disconnected users see the connect CTA", () => {
  const result = presentVercelSetup({ vercel: capability() });

  assert.equal(result.state, "disconnected");
  assert.equal(result.canLaunchSandbox, false);
  assert.deepEqual(result.primaryAction, {
    kind: "connect",
    label: "Connect Vercel",
    href: "/api/auth/vercel",
  });
});

test("presentVercelSetup: missing user falls back to disconnected", () => {
  const result = presentVercelSetup(null);
  assert.equal(result.state, "disconnected");
  assert.equal(result.canLaunchSandbox, false);
});
