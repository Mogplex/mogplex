import assert from "node:assert/strict";
import test from "node:test";

let importCounter = 0;
async function loadBilling() {
  // Require a fresh module per test so env reads pick up the override.
  importCounter += 1;
  const url = new URL(
    `../../lib/sandbox/billing.ts?bust=${importCounter}`,
    import.meta.url
  ).href;
  return import(url);
}

test("resolveEffectiveSandboxBillingMode keeps user billing disabled without relying on an env switch", async () => {
  const prior = process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING;
  delete process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING;
  try {
    const { resolveEffectiveSandboxBillingMode } = await loadBilling();
    const mode = resolveEffectiveSandboxBillingMode({
      workspaceBillingModeInput: "user_vercel_project",
    });
    assert.equal(mode, "platform");
  } finally {
    if (prior !== undefined)
      process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING = prior;
  }
});

test("resolveEffectiveSandboxBillingMode forces platform when NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING=1", async () => {
  const prior = process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING;
  process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING = "1";
  const originalWarn = console.warn;
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  try {
    const { resolveEffectiveSandboxBillingMode } = await loadBilling();
    const mode = resolveEffectiveSandboxBillingMode({
      workspaceBillingModeInput: "user_vercel_project",
      repoBillingModeOverrideInput: "user_vercel_project",
    });
    assert.equal(mode, "platform");
    assert.equal(warned, true);
  } finally {
    console.warn = originalWarn;
    if (prior === undefined)
      delete process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING;
    else process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING = prior;
  }
});

test("resolveSandboxBilling returns platform branch when kill-switch downgrades the mode", async () => {
  const prior = process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING;
  process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING = "1";
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const { resolveSandboxBilling } = await loadBilling();
    const resolution = resolveSandboxBilling({
      workspaceBillingModeInput: "user_vercel_project",
      workspaceLinkedProjectId: "proj_123",
      workspaceLinkedTeamId: "team_abc",
    });
    assert.equal(resolution.ok, true);
    assert.equal(resolution.billingSource, "platform");
    assert.equal(resolution.projectId, null);
    assert.equal(resolution.teamId, null);
  } finally {
    console.warn = originalWarn;
    if (prior === undefined)
      delete process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING;
    else process.env.NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING = prior;
  }
});
