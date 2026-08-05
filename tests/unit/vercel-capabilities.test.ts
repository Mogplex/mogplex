import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveVercelCapability,
  resolveLinkedProjectState,
} from "../../lib/vercel/capabilities";

test("resolveLinkedProjectState prioritizes repo-linked projects over workspace-linked projects", () => {
  assert.equal(
    resolveLinkedProjectState({
      repoLinkedProjectCount: 2,
      workspaceLinkedProjectCount: 1,
    }),
    "repo"
  );
});

test("deriveVercelCapability keeps user billing unavailable for identity-only Vercel links", () => {
  assert.deepEqual(
    deriveVercelCapability({
      platformState: "ready",
      personalState: "linked",
      linkedProjectState: "workspace",
    }),
    {
      platformState: "ready",
      personalState: "linked",
      linkedProjectState: "workspace",
      canUsePlatformOps: true,
      canLinkUserBillingProject: false,
      canUseUserBilling: false,
      statusLabel: "Platform ready",
      statusDetail:
        "Mogplex platform Vercel is ready. Sign in with Vercel is identity-only; user-owned compute requires a future API-capable integration.",
    }
  );
});

test("resolveLinkedProjectState returns 'account' when only an account default is set", () => {
  assert.equal(
    resolveLinkedProjectState({
      repoLinkedProjectCount: 0,
      workspaceLinkedProjectCount: 0,
      accountDefaultProjectId: "prj_acct",
    }),
    "account"
  );
});

test("resolveLinkedProjectState prefers workspace overrides over account defaults", () => {
  assert.equal(
    resolveLinkedProjectState({
      repoLinkedProjectCount: 0,
      workspaceLinkedProjectCount: 1,
      accountDefaultProjectId: "prj_acct",
    }),
    "workspace"
  );
});

test("deriveVercelCapability does not revive a stale account default", () => {
  const capability = deriveVercelCapability({
    platformState: "ready",
    personalState: "linked",
    linkedProjectState: "account",
  });
  assert.equal(capability.canLinkUserBillingProject, false);
  assert.equal(capability.canUseUserBilling, false);
  assert.match(capability.statusDetail, /identity-only/);
});
