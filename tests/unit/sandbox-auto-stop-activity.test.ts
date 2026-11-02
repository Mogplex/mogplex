import assert from "node:assert/strict";
import test from "node:test";

test("cleanup activity queries exclude only the finishing call and stay within its owner", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  type Row = { id: string; ai_call_id: string; user_id: string };
  const current: Row = {
    id: "current-call",
    ai_call_id: "current-call",
    user_id: "user-1",
  };
  const foreign: Row = {
    id: "foreign-call",
    ai_call_id: "foreign-call",
    user_id: "user-2",
  };
  let rows: Row[] = [current, foreign];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const matching = rows.filter((row) =>
      Object.entries(row).every(([key, value]) => {
        const filter = url.searchParams.get(key);
        if (!filter) return true;
        return filter.startsWith("neq.")
          ? value !== filter.slice(4)
          : value === filter.slice(3);
      })
    );
    return new Response(null, {
      status: 200,
      headers: { "content-range": `0-0/${matching.length}` },
    });
  };
  try {
    const { hasActiveAiCall, hasRunningAutomation } =
      await import("../../lib/sandbox/auto-pause-deps");
    const sandboxRecordId = "00000000-0000-4000-8000-000000000001";
    const input = {
      sandboxRecordId,
      sandboxId: "vm-1",
      excludeAiCallId: current.id,
      userId: current.user_id,
    };
    assert.equal(await hasActiveAiCall(input), false);
    assert.equal(
      await hasRunningAutomation(sandboxRecordId, current.id, current.user_id),
      false
    );

    rows = [
      ...rows,
      { id: "other-call", ai_call_id: "other-call", user_id: "user-1" },
    ];
    assert.equal(await hasActiveAiCall(input), true);
    assert.equal(
      await hasRunningAutomation(sandboxRecordId, current.id, current.user_id),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
