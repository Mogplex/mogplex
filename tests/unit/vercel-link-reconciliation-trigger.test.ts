import assert from "node:assert/strict";
import test from "node:test";

async function loadTriggerTask() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../trigger/vercel-link-reconciliation");
}

test("runScheduledVercelLinkReconciliation delegates to the shared runner and records summary metadata", async () => {
  const { runScheduledVercelLinkReconciliation } = await loadTriggerTask();
  const metadataEntries: Array<[string, unknown]> = [];
  const logs: Array<{ message: string; data: unknown }> = [];
  const metadataStub = {
    set(key: string, value: unknown) {
      metadataEntries.push([key, value]);
      return metadataStub;
    },
  };

  const summary = await runScheduledVercelLinkReconciliation({
    runVercelLinkReconciliation: async () => ({
      processed: 7,
      valid: 3,
      missing_project: 1,
      auth_invalid: 2,
      inaccessible: 0,
      failed: 1,
    }),
    metadata: metadataStub as never,
    logger: {
      log: (message, data) => {
        logs.push({ message, data });
      },
    },
  });

  assert.deepEqual(summary, {
    processed: 7,
    valid: 3,
    missing_project: 1,
    auth_invalid: 2,
    inaccessible: 0,
    failed: 1,
  });
  assert.deepEqual(metadataEntries, [
    ["processed", 7],
    ["failed", 1],
    ["valid", 3],
    ["missingProject", 1],
    ["authInvalid", 2],
    ["inaccessible", 0],
  ]);
  assert.deepEqual(logs, [
    {
      message: "Reconciled 7 Vercel billing link(s)",
      data: {
        processed: 7,
        valid: 3,
        missing_project: 1,
        auth_invalid: 2,
        inaccessible: 0,
        failed: 1,
      },
    },
  ]);
});
