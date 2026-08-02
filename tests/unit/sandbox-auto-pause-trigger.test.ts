import assert from "node:assert/strict";
import test from "node:test";

async function loadTriggerTask() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../trigger/sandbox-auto-pause");
}

test("runSandboxAutoPauseTask delegates to the shared runner and records metadata", async () => {
  const { runSandboxAutoPauseTask } = await loadTriggerTask();
  const metadataEntries: Array<[string, unknown]> = [];
  const logs: Array<{ message: string; data: unknown }> = [];
  const metadataStub = {
    set(key: string, value: unknown) {
      metadataEntries.push([key, value]);
      return metadataStub;
    },
  };

  const payload = {
    sandboxRecordId: "sandbox-record-1",
    sandboxId: "vm_123",
    userId: "user-1",
    tabId: "tab-1",
    sessionId: "session-1",
    releasedAt: "2026-05-20T12:00:00.000Z",
    releaseEventId: "event-release-1",
    gracePeriodMs: 90_000,
  };

  const result = await runSandboxAutoPauseTask(payload, {
    runSandboxAutoPauseCheck: async () => ({
      decisionCode: "would_auto_pause",
      paused: false,
      message: "Sandbox would auto-pause; observe-only mode is active.",
    }),
    metadata: metadataStub as never,
    logger: {
      log(message, data) {
        logs.push({ message, data });
      },
    },
  });

  assert.deepEqual(result, {
    decisionCode: "would_auto_pause",
    paused: false,
    message: "Sandbox would auto-pause; observe-only mode is active.",
  });
  assert.deepEqual(metadataEntries, [
    ["sandboxRecordId", "sandbox-record-1"],
    ["decisionCode", "would_auto_pause"],
    ["paused", false],
  ]);
  assert.deepEqual(logs, [
    {
      message: "Sandbox would auto-pause; observe-only mode is active.",
      data: {
        sandboxRecordId: "sandbox-record-1",
        sandboxId: "vm_123",
        decisionCode: "would_auto_pause",
        paused: false,
      },
    },
  ]);
});
