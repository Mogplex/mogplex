import assert from "node:assert/strict";
import test from "node:test";
import { getSessionSandboxRestartCandidate } from "../../lib/sandbox/session-auto-restart";
import { sandboxRecord } from "../../lib/sandbox/test-fixtures";
import type { StopReason } from "../../lib/types";

function candidateForStopReason(stopReason: StopReason | null) {
  return getSessionSandboxRestartCandidate({
    activeRepoId: "repo-1",
    activeSessionId: "session-1",
    activeSessionSandbox: sandboxRecord({
      status: "stopped",
      healthStatus: "stopped",
      stopReason,
    }),
    activeSessionSandboxId: "record-1",
    autoRestartedSandboxId: null,
    sandboxCreating: false,
  });
}

test("manual sandbox stops stay stopped until an explicit restart", () => {
  assert.equal(candidateForStopReason("manual"), null);
});

test("billing-depleted sandboxes cannot auto-restart", () => {
  assert.equal(candidateForStopReason("billing_depleted"), null);
});

test("unexpected provider loss can still recover the restored session", () => {
  assert.deepEqual(candidateForStopReason("vm_gone"), {
    repoId: "repo-1",
    sessionId: "session-1",
    previousSandboxId: "record-1",
    pendingSandboxBranch: "feature/chip",
  });
});
