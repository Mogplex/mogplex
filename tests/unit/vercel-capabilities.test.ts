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

test("deriveVercelCapability reports user billing readiness only when a personal link and billing project both exist", () => {
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
      canLinkUserBillingProject: true,
      canUseUserBilling: true,
      statusLabel: "Platform ready",
      statusDetail:
        "Mogplex platform Vercel is ready. Personal Vercel is linked and at least one project billing link is selected.",
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

test("deriveVercelCapability treats account default as billable", () => {
  const capability = deriveVercelCapability({
    platformState: "ready",
    personalState: "linked",
    linkedProjectState: "account",
  });
  assert.equal(capability.canUseUserBilling, true);
  assert.match(capability.statusDetail, /default billing project is set/);
});
