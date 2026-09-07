import assert from "node:assert/strict";
import test from "node:test";

async function loadControlChatRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/control/chat/route");
}

test("Control chat reserves the platform's extended execution duration", async () => {
  // A coordinator turn plans, starts compute, creates checkouts, launches
  // workers, and saves its handoff. Under the project default of 300s the
  // function was killed mid-turn, leaving the call streaming forever and the
  // saved follow-up never marked ready.
  const route = await loadControlChatRoute();
  assert.equal("maxDuration" in route ? route.maxDuration : undefined, 800);
});
