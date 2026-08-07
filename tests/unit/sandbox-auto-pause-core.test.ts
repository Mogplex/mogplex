import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeps,
  buildPayload,
  loadAutoPauseModule,
  sandboxRecordId,
} from "./helpers/sandbox-auto-pause-fixtures";

test("auto-pause records would_auto_pause in observe-only mode", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps();

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "would_auto_pause");
  assert.equal(result.paused, false);
  assert.equal(harness.stopCalls, 0);
  assert.equal(harness.updates.length, 0);
  assert.equal(harness.events.at(-1)?.decisionCode, "would_auto_pause");
});

test("auto-pause pauses a detached persistent sandbox when enabled", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({ mode: "enabled" });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_succeeded");
  assert.equal(result.paused, true);
  assert.deepEqual(harness.claims, [
    {
      sandboxRecordId,
      sandboxId: "vm_123",
      releasedAt:
        harness.deps.nowMs() - 91_000 > 0
          ? new Date(harness.deps.nowMs() - 91_000).toISOString()
          : buildPayload().releasedAt,
    },
  ]);
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

test("auto-pause warns when a persistent sandbox stops without a snapshot id", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({
    mode: "enabled",
    currentSnapshotId: null,
  });
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const result = await runSandboxAutoPauseCheck(
      buildPayload(),
      harness.deps as never
    );

    assert.equal(result.decisionCode, "auto_pause_succeeded");
    assert.equal(result.paused, true);
    assert.equal(harness.updates.length, 1);
    assert.deepEqual(harness.updates[0].updates, {
      status: "paused",
      health_status: "paused",
      stop_reason: "auto_pause",
      snapshot_id: null,
    });
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /without a snapshot ID/);
    assert.deepEqual(warnings[0][1], {
      sandboxRecordId,
      sandboxId: "vm_123",
    });
  } finally {
    console.warn = originalWarn;
  }
});

test("auto-pause still stops idle compute when billing close preparation fails", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({
    mode: "enabled",
    billingCloseError: new Error("billing RPC unavailable"),
  });
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);

  try {
    const result = await runSandboxAutoPauseCheck(
      buildPayload(),
      harness.deps as never
    );

    assert.equal(result.decisionCode, "auto_pause_succeeded");
    assert.equal(harness.stopCalls, 1);
    assert.match(String(warnings[0]?.[0]), /stopping idle compute/);
  } finally {
    console.warn = originalWarn;
  }
});
