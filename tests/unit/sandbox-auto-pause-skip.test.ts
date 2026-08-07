import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeps,
  buildPayload,
  buildRecord,
  loadAutoPauseModule,
} from "./helpers/sandbox-auto-pause-fixtures";

test("auto-pause skips when another workspace session is still attached", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({ activeSessionCount: 1, mode: "enabled" });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_skipped_new_session");
  assert.equal(harness.stopCalls, 0);
});

test("auto-pause skips old release workers after a reload reattaches", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({ newerSessionEventCount: 1, mode: "enabled" });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_skipped_new_session");
  assert.equal(harness.stopCalls, 0);
});

test("auto-pause skips active exec locks and active AI calls", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();

  const execHarness = buildDeps({
    record: buildRecord({ exec_lock_token: "lock-1" }),
    mode: "enabled",
  });
  const execResult = await runSandboxAutoPauseCheck(
    buildPayload(),
    execHarness.deps as never
  );
  assert.equal(execResult.decisionCode, "auto_pause_skipped_busy");
  assert.equal(execHarness.stopCalls, 0);

  const aiHarness = buildDeps({ activeAiCall: true, mode: "enabled" });
  const aiResult = await runSandboxAutoPauseCheck(
    buildPayload(),
    aiHarness.deps as never
  );
  assert.equal(aiResult.decisionCode, "auto_pause_skipped_busy");
  assert.equal(aiHarness.stopCalls, 0);
});

test("auto-pause skips running automations tied to the sandbox", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({ runningAutomation: true, mode: "enabled" });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_skipped_busy");
  assert.equal(harness.stopCalls, 0);
});

test("auto-pause repeats busy checks immediately before stopping", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({
    activeAiCallSequence: [false, true],
    mode: "enabled",
  });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_skipped_busy");
  assert.equal(harness.stopCalls, 0);
  assert.equal(harness.events.at(-1)?.payload?.phase, "final_check");
});

test("auto-pause duplicate worker runs no-op when claim fails", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({ mode: "enabled", claimResult: false });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.equal(result.decisionCode, "auto_pause_skipped_status_changed");
  assert.equal(harness.stopCalls, 0);
  assert.equal(harness.events.at(-1)?.payload?.phase, "claim");
});

test("auto-pause skips duplicate workers that observe an in-flight pausing record", async () => {
  const { runSandboxAutoPauseCheck } = await loadAutoPauseModule();
  const harness = buildDeps({
    mode: "enabled",
    record: buildRecord({
      status: "pausing",
      health_status: "pausing",
      stop_reason: "auto_pause",
    } as never),
  });

  const result = await runSandboxAutoPauseCheck(
    buildPayload(),
    harness.deps as never
  );

  assert.match(result.decisionCode, /^auto_pause_skipped_/);
  assert.equal(harness.stopCalls, 0);
  assert.equal(harness.claims.length, 0);
  assert.equal(harness.updates.length, 0);
});
