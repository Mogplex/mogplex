import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeps,
  buildPayload,
  loadAutoPauseModule,
} from "./helpers/sandbox-auto-pause-fixtures";

test("auto-pause restores running state when remote stop fails after claim", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({
    mode: "enabled",
    stopError: new Error("stop failed"),
  });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_failed");
  assert.equal(result.paused, false);
  assert.equal(harness.stopCalls, 1);
  assert.equal(harness.updates.length, 1);
  assert.deepEqual(harness.updates[0].updates, {
    status: "running",
    health_status: "running",
    stop_reason: null,
  });
  assert.deepEqual(harness.updates[0].options, {
    expectedSandboxId: "vm_123",
    fromStatuses: "pausing",
  });
});

test("auto-pause treats lost paused finalization CAS as a no-op without retrying remote stop", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({
    mode: "enabled",
    updateResult: null,
  });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_skipped_status_changed");
  assert.equal(result.paused, false);
  assert.equal(harness.stopCalls, 1);
  assert.equal(harness.updates.length, 1);
  assert.deepEqual(harness.updates[0].updates, {
    status: "paused",
    health_status: "paused",
    stop_reason: "auto_pause",
    snapshot_id: "snap_123",
  });
  assert.deepEqual(harness.updates[0].options, {
    expectedSandboxId: "vm_123",
    fromStatuses: "pausing",
  });
});
