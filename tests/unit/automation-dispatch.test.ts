import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "service-role-key";

async function loadAutomationDispatchModule() {
  return import("../../lib/automation-dispatch");
}

test("legacy trigger-coded flow dispatch events normalize to flow", async () => {
  const { getAutomationDispatchSourceKind } =
    await loadAutomationDispatchModule();
  assert.equal(
    getAutomationDispatchSourceKind({
      source_kind: "trigger",
      flow_id: "flow-1",
    }),
    "flow"
  );
});

test("non-flow dispatch events keep their stored source kind", async () => {
  const { getAutomationDispatchSourceKind } =
    await loadAutomationDispatchModule();
  assert.equal(
    getAutomationDispatchSourceKind({
      source_kind: "trigger",
      flow_id: null,
    }),
    "trigger"
  );

  assert.equal(
    getAutomationDispatchSourceKind({
      source_kind: "manual_retry",
      flow_id: null,
    }),
    "manual_retry"
  );
});
