import assert from "node:assert/strict";
import test from "node:test";
import {
  presentSandboxEmptyState,
  presentVercelSetup,
} from "../../lib/activation/setup-state";
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

test("presentVercelSetup lets platform-billed users launch", () => {
  const result = presentVercelSetup({
    vercel: capability(),
    platform_access: { allowPlatformSandbox: true, allowPlatformAi: true },
  });

  assert.equal(result.state, "platform_billed");
  assert.equal(result.canLaunchSandbox, true);
  assert.equal(result.primaryAction, null);
});

test("presentVercelSetup sends users without platform access to billing", () => {
  const result = presentVercelSetup({
    vercel: capability({
      personalState: "linked",
      linkedProjectState: "workspace",
      canLinkUserBillingProject: true,
      canUseUserBilling: true,
    }),
  });

  assert.equal(result.state, "billing_required");
  assert.equal(result.canLaunchSandbox, false);
  assert.deepEqual(result.primaryAction, {
    kind: "billing",
    label: "Open billing settings",
    href: "/settings?section=billing",
  });
  assert.deepEqual(presentSandboxEmptyState(result), {
    title: "Add sandbox billing",
    detail: "Add funds or choose a plan in Billing before launching a sandbox.",
  });
});

test("presentVercelSetup does not offer an impossible connection path", () => {
  const result = presentVercelSetup(null);
  assert.equal(result.state, "billing_required");
  assert.doesNotMatch(result.detail, /connect vercel/i);
});
