import assert from "node:assert/strict";
import test from "node:test";

async function loadTriggerTask() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../trigger/reconcile-sandbox-billing");
}

test("scheduled sandbox billing reconciliation records enforcement outcomes", async () => {
  const { runScheduledSandboxBillingReconciliation } = await loadTriggerTask();
  const metadataEntries: Array<[string, unknown]> = [];
  const logs: Array<{ level: string; message: string; data: unknown }> = [];
  const metadataStub = {
    set(key: string, value: unknown) {
      metadataEntries.push([key, value]);
      return metadataStub;
    },
  };
  const expected = {
    processed: 4,
    opened: 1,
    accrued: 1,
    finalized: 1,
    rotated: 0,
    depleted: 1,
    skipped: 0,
    failed: 0,
    errors: [],
    message: "Reconciled 4 sandbox billing sessions.",
  };

  const summary = await runScheduledSandboxBillingReconciliation({
    reconcile: async () => expected,
    metadata: metadataStub as never,
    logger: {
      log(message, data) {
        logs.push({ level: "log", message, data });
      },
      error(message, data) {
        logs.push({ level: "error", message, data });
      },
    },
  });

  assert.deepEqual(summary, expected);
  assert.deepEqual(metadataEntries, [
    ["processed", 4],
    ["accrued", 1],
    ["finalized", 1],
    ["rotated", 0],
    ["opened", 1],
    ["depleted", 1],
    ["skipped", 0],
    ["failed", 0],
  ]);
  assert.deepEqual(logs, [
    {
      level: "log",
      message: expected.message,
      data: expected,
    },
  ]);
});

test("scheduled sandbox billing reconciliation logs isolated failures", async () => {
  const { runScheduledSandboxBillingReconciliation } = await loadTriggerTask();
  const errors: unknown[] = [];
  const expected = {
    processed: 1,
    opened: 0,
    accrued: 0,
    finalized: 0,
    rotated: 0,
    depleted: 0,
    skipped: 0,
    failed: 1,
    errors: [{ sessionId: "billing-session-1", message: "provider 429" }],
    message: "Reconciled 1 sandbox billing session with 1 failure.",
  };

  await runScheduledSandboxBillingReconciliation({
    reconcile: async () => expected,
    metadata: { set: () => null } as never,
    logger: {
      log() {
        throw new Error("success logger should not be used");
      },
      error(message, data) {
        errors.push([message, data]);
      },
    },
  });

  assert.deepEqual(errors, [[expected.message, { errors: expected.errors }]]);
});
