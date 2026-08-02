import assert from "node:assert/strict";
import test from "node:test";

async function loadTriggerTask() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../trigger/sandbox-reaper");
}

test("runScheduledSandboxReaper delegates to the shared runner and records summary metadata", async () => {
  const { runScheduledSandboxReaper } = await loadTriggerTask();
  const metadataEntries: Array<[string, unknown]> = [];
  const logs: Array<{ message: string; data: unknown }> = [];
  const metadataStub = {
    set(key: string, value: unknown) {
      metadataEntries.push([key, value]);
      return metadataStub;
    },
  };

  const summary = await runScheduledSandboxReaper({
    runSandboxReaper: async () => ({
      processed: 5,
      reaped: 2,
      message: "Processed 5 sandboxes",
      results: [
        { id: "sandbox-1", action: "stopped_vm_gone" },
        { id: "sandbox-2", action: "marked_idle_warning" },
      ],
    }),
    metadata: metadataStub as never,
    logger: {
      log(message, data) {
        logs.push({ message, data });
      },
    },
  });

  assert.deepEqual(summary, {
    processed: 5,
    reaped: 2,
    message: "Processed 5 sandboxes",
    results: [
      { id: "sandbox-1", action: "stopped_vm_gone" },
      { id: "sandbox-2", action: "marked_idle_warning" },
    ],
  });
  assert.deepEqual(metadataEntries, [
    ["processed", 5],
    ["reaped", 2],
  ]);
  assert.deepEqual(logs, [
    {
      message: "Processed 5 sandboxes",
      data: {
        processed: 5,
        reaped: 2,
        message: "Processed 5 sandboxes",
        results: [
          { id: "sandbox-1", action: "stopped_vm_gone" },
          { id: "sandbox-2", action: "marked_idle_warning" },
        ],
      },
    },
  ]);
});
