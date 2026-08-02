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
