import assert from "node:assert/strict";
import test from "node:test";

async function loadPlatformAccess() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/platform-access");
}

test("derivePlatformAccess allows both platform resources for env-allowlisted users", async () => {
  const { derivePlatformAccess } = await loadPlatformAccess();

  const access = derivePlatformAccess(
    {
      id: "user-123",
      email: "dev@example.com",
      allow_platform_ai: false,
      allow_platform_sandbox: false,
    },
    {
      PLATFORM_ACCESS_USER_IDS: "user-123",
    } as unknown as NodeJS.ProcessEnv
  );

  assert.deepEqual(access, {
    allowPlatformAi: true,
    allowPlatformSandbox: true,
  });
});

test("derivePlatformAccess keeps AI and sandbox flags independently configurable on the profile", async () => {
  const { derivePlatformAccess } = await loadPlatformAccess();

  const access = derivePlatformAccess(
    {
      id: "user-123",
      email: "dev@example.com",
      allow_platform_ai: true,
      allow_platform_sandbox: false,
    },
    {} as unknown as NodeJS.ProcessEnv
  );

  assert.deepEqual(access, {
    allowPlatformAi: true,
    allowPlatformSandbox: false,
  });
});

test("derivePlatformAccess grants blackbox.ai emails platform access without env config", async () => {
  const { derivePlatformAccess } = await loadPlatformAccess();

  const access = derivePlatformAccess(
    {
      id: "user-789",
      email: "someone@blackbox.ai",
      allow_platform_ai: false,
      allow_platform_sandbox: false,
    },
    {} as unknown as NodeJS.ProcessEnv
  );

  assert.deepEqual(access, {
    allowPlatformAi: true,
    allowPlatformSandbox: true,
  });
});

test("derivePlatformAccess allows both platform resources for domain-allowlisted emails", async () => {
  const { derivePlatformAccess } = await loadPlatformAccess();

  const access = derivePlatformAccess(
    {
      id: "user-456",
      email: "allowlisted@partner-domain.test",
      allow_platform_ai: false,
      allow_platform_sandbox: false,
    },
    {
      PLATFORM_ACCESS_EMAIL_DOMAINS: "partner-domain.test, @other-domain.test",
    } as unknown as NodeJS.ProcessEnv
  );

  assert.deepEqual(access, {
    allowPlatformAi: true,
    allowPlatformSandbox: true,
  });
});

test("loadUserPlatformAccess grants hosted resources to a funded personal account", async () => {
  const { createLoadUserPlatformAccess } = await loadPlatformAccess();
  const billingLookups: Array<{
    userId: string;
    productTeamId: string | null | undefined;
  }> = [];
  const loadAccess = createLoadUserPlatformAccess({
    env: {} as NodeJS.ProcessEnv,
    loadProfile: async () => ({
      id: "user-paid",
      email: "paid@example.com",
      allow_platform_ai: false,
      allow_platform_sandbox: false,
    }),
    loadBillingAccess: async (userId, productTeamId) => {
      billingLookups.push({ userId, productTeamId });
      return true;
    },
  });

  assert.deepEqual(await loadAccess("user-paid"), {
    allowPlatformAi: true,
    allowPlatformSandbox: true,
  });
  assert.deepEqual(billingLookups, [
    { userId: "user-paid", productTeamId: undefined },
  ]);
});

test("loadUserPlatformAccess resolves the active team's billing balance", async () => {
  const { createLoadUserPlatformAccess } = await loadPlatformAccess();
  let resolvedTeamId: string | null | undefined;
  const membershipLookups: Array<[string, string]> = [];
  const loadAccess = createLoadUserPlatformAccess({
    env: {} as NodeJS.ProcessEnv,
    loadProfile: async () => ({
      id: "user-member",
      email: "member@example.com",
      allow_platform_ai: false,
      allow_platform_sandbox: false,
    }),
    loadTeamMembership: async (userId, productTeamId) => {
      membershipLookups.push([userId, productTeamId]);
      return true;
    },
    loadBillingAccess: async (_userId, productTeamId) => {
      resolvedTeamId = productTeamId;
      return productTeamId === "team-funded";
    },
  });

  assert.deepEqual(await loadAccess("user-member", "team-funded"), {
    allowPlatformAi: true,
    allowPlatformSandbox: true,
  });
  assert.equal(resolvedTeamId, "team-funded");
  assert.deepEqual(membershipLookups, [["user-member", "team-funded"]]);
});

test("loadUserPlatformAccess rejects a funded team when the user is not a member", async () => {
  const { createLoadUserPlatformAccess } = await loadPlatformAccess();
  let billingLookups = 0;
  const loadAccess = createLoadUserPlatformAccess({
    env: {} as NodeJS.ProcessEnv,
    loadProfile: async () => ({
      id: "user-removed",
      email: "removed@example.com",
      allow_platform_ai: false,
      allow_platform_sandbox: false,
    }),
    loadTeamMembership: async () => false,
    loadBillingAccess: async () => {
      billingLookups += 1;
      return true;
    },
  });

  assert.deepEqual(await loadAccess("user-removed", "team-funded"), {
    allowPlatformAi: false,
    allowPlatformSandbox: false,
  });
  assert.equal(billingLookups, 0);
});

test("loadUserPlatformAccess reuses a short-lived balance read after rechecking team membership", async () => {
  const { createLoadUserPlatformAccess } = await loadPlatformAccess();
  let membershipLookups = 0;
  let billingLookups = 0;
  const loadAccess = createLoadUserPlatformAccess({
    env: {} as NodeJS.ProcessEnv,
    loadProfile: async () => ({
      id: "user-member",
      email: "member@example.com",
      allow_platform_ai: false,
      allow_platform_sandbox: false,
    }),
    loadTeamMembership: async () => {
      membershipLookups += 1;
      return true;
    },
    loadBillingAccess: async () => {
      billingLookups += 1;
      return true;
    },
  });

  await Promise.all([
    loadAccess("user-member", "team-funded"),
    loadAccess("user-member", "team-funded"),
  ]);

  assert.equal(membershipLookups, 2);
  assert.equal(billingLookups, 1);
});

test("loadUserPlatformAccess skips billing for allowlisted users", async () => {
  const { createLoadUserPlatformAccess } = await loadPlatformAccess();
  let billingLookups = 0;
  const loadAccess = createLoadUserPlatformAccess({
    env: {
      PLATFORM_ACCESS_USER_IDS: "user-allowlisted",
    } as unknown as NodeJS.ProcessEnv,
    loadProfile: async () => ({
      id: "user-allowlisted",
      email: "dev@example.com",
      allow_platform_ai: false,
      allow_platform_sandbox: false,
    }),
    loadBillingAccess: async () => {
      billingLookups += 1;
      return false;
    },
  });

  assert.deepEqual(await loadAccess("user-allowlisted"), {
    allowPlatformAi: true,
    allowPlatformSandbox: true,
  });
  assert.equal(billingLookups, 0);
});
