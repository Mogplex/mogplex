import assert from "node:assert/strict";
import test from "node:test";

async function loadPlatformAccess() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/platform-access");
}

const profile = {
  id: "user-1",
  email: "dev@example.com",
  allow_platform_ai: false,
  allow_platform_sandbox: false,
};

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

test("self-host mode grants platform AI and sandboxes without billing", async () => {
  const { createLoadUserPlatformAccess } = await loadPlatformAccess();
  let billingLookups = 0;
  const loadAccess = createLoadUserPlatformAccess({
    env: env({ MOGPLEX_SELF_HOSTED: "1" }),
    loadProfile: async () => profile,
    loadBillingAccess: async () => {
      billingLookups += 1;
      return false;
    },
  });

  assert.deepEqual(await loadAccess("user-1"), {
    allowPlatformAi: true,
    allowPlatformSandbox: true,
  });
  assert.equal(billingLookups, 0);
});

test("self-host mode domain gate leaves other users on billing rules", async () => {
  const { derivePlatformAccess } = await loadPlatformAccess();
  const gated = env({
    MOGPLEX_SELF_HOSTED: "1",
    MOGPLEX_SELF_HOSTED_ALLOWED_EMAIL_DOMAINS: "example.com",
  });

  assert.deepEqual(derivePlatformAccess(profile, gated), {
    allowPlatformAi: true,
    allowPlatformSandbox: true,
  });
  assert.deepEqual(
    derivePlatformAccess({ ...profile, email: "someone@gmail.com" }, gated),
    { allowPlatformAi: false, allowPlatformSandbox: false }
  );
});

test("self-host mode is refused while Stripe billing is configured", async () => {
  const { createLoadUserPlatformAccess } = await loadPlatformAccess();
  let billingLookups = 0;
  const loadAccess = createLoadUserPlatformAccess({
    env: env({ MOGPLEX_SELF_HOSTED: "1", STRIPE_SECRET_KEY: "sk_live_x" }),
    loadProfile: async () => profile,
    loadBillingAccess: async () => {
      billingLookups += 1;
      return false;
    },
  });

  assert.deepEqual(await loadAccess("user-1"), {
    allowPlatformAi: false,
    allowPlatformSandbox: false,
  });
  assert.equal(billingLookups, 1);
});

test("self-host mode is refused in hosted Trigger.dev workers without a Stripe key", async () => {
  const { derivePlatformAccess } = await loadPlatformAccess();
  const { HOSTED_TRIGGER_PROJECT_REF } =
    await import("../../lib/trigger/project-ref");

  assert.deepEqual(
    derivePlatformAccess(
      profile,
      env({
        MOGPLEX_SELF_HOSTED: "1",
        TRIGGER_PROJECT_REF: HOSTED_TRIGGER_PROJECT_REF,
      })
    ),
    { allowPlatformAi: false, allowPlatformSandbox: false }
  );
});
