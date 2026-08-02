import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHarnessResumeRetryNotice,
  isRecoverableHarnessResumeFailure,
} from "../../lib/harness/resume-recovery";

test("detects recoverable Claude resume failures", () => {
  assert.equal(
    isRecoverableHarnessResumeFailure(
      "claude-code",
      "Failed to resume session: session not found for --resume abc123"
    ),
    true
  );
  assert.equal(
    isRecoverableHarnessResumeFailure(
      "claude-code",
      "No conversation found with session ID: 00000000-0000-4000-8000-000000000000"
    ),
    true
  );
  assert.equal(
    isRecoverableHarnessResumeFailure(
      "claude-code",
      "No conversation found while reading config.\nSession ID is optional."
    ),
    false
  );
  assert.equal(
    isRecoverableHarnessResumeFailure(
      "claude-code",
      "Permission denied while reading ./secrets"
    ),
    false
  );
});

test("detects recoverable Codex resume failures", () => {
  assert.equal(
    isRecoverableHarnessResumeFailure(
      "codex",
      "Unable to resume thread: invalid session identifier"
    ),
    true
  );
  assert.equal(
    isRecoverableHarnessResumeFailure(
      "codex",
      "thread/resume failed: no rollout found for thread id 00000000-0000-4000-8000-000000000000"
    ),
    true
  );
  assert.equal(
    isRecoverableHarnessResumeFailure(
      "codex",
      "No rollout found in the cache.\nThread ID is optional."
    ),
    false
  );
  assert.equal(
    isRecoverableHarnessResumeFailure(
      "codex",
      "Build failed because npm exited with code 1"
    ),
    false
  );
});

test("formats a fresh-start notice for retried harness sessions", () => {
  assert.equal(
    buildHarnessResumeRetryNotice("claude-code"),
    "[previous Claude Code session unavailable; starting fresh]"
  );
  assert.equal(
    buildHarnessResumeRetryNotice("codex"),
    "[previous harness session unavailable; starting fresh]"
  );
});
