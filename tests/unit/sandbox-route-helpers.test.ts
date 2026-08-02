import assert from "node:assert/strict";
import test from "node:test";

async function loadSandboxRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/liveness");
}

test("isStalePendingSandbox only reclaims old pending placeholders", async () => {
  const { isStalePendingSandbox } = await loadSandboxRoute();
  const originalNow = Date.now;
  Date.now = () => new Date("2026-03-24T12:00:00.000Z").getTime();

  try {
    assert.equal(
      isStalePendingSandbox({
        sandbox_id: "pending",
        status: "creating",
        created_at: "2026-03-24T11:58:45.000Z",
        last_boot_started_at: "2026-03-24T11:58:45.000Z",
      }),
      false
    );

    assert.equal(
      isStalePendingSandbox({
        sandbox_id: "pending",
        status: "installing",
        created_at: "2026-03-24T11:58:20.000Z",
        last_boot_started_at: "2026-03-24T11:58:20.000Z",
      }),
      true
    );

    assert.equal(
      isStalePendingSandbox({
        sandbox_id: "sandbox-live",
        status: "creating",
        created_at: "2026-03-24T11:40:00.000Z",
        last_boot_started_at: "2026-03-24T11:40:00.000Z",
      }),
      false
    );
  } finally {
    Date.now = originalNow;
  }
});
