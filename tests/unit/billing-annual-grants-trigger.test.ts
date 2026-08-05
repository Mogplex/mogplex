import assert from "node:assert/strict";
import test from "node:test";

async function loadTriggerTask() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../trigger/grant-annual-included-usage");
}

test("scheduled annual grants expose grant and failure counts", async () => {
  const { runScheduledAnnualIncludedUsageGrants } = await loadTriggerTask();
  const metadataEntries: Array<[string, unknown]> = [];
  const logs: unknown[] = [];
  const metadataStub = {
    set(key: string, value: unknown) {
      metadataEntries.push([key, value]);
      return metadataStub;
    },
  };
  const expected = {
    scanned: 8,
    granted: 3,
    duplicates: 2,
    skipped: 2,
    errored: 1,
    disabled: false,
  };

  const summary = await runScheduledAnnualIncludedUsageGrants({
    runAnnualIncludedUsageGrants: async () => expected,
    metadata: metadataStub as never,
    logger: { log: (message, data) => logs.push({ message, data }) },
  });

  assert.deepEqual(summary, expected);
  assert.deepEqual(metadataEntries, [
    ["scanned", 8],
    ["granted", 3],
    ["duplicates", 2],
    ["skipped", 2],
    ["errored", 1],
    ["disabled", false],
  ]);
  assert.deepEqual(logs, [
    { message: "Granted annual-plan monthly included usage", data: expected },
  ]);
});
