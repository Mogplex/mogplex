import assert from "node:assert/strict";
import test from "node:test";
import { createHarnessSessionParser } from "../../lib/harness/session-parser";

test("Claude session parser extracts session ids from stream-json lines", () => {
  const parser = createHarnessSessionParser("claude-code");
  const sessionId = "claude-session-123";

  assert.equal(
    parser.push(
      "stdout",
      `{"type":"system","subtype":"init","session_id":"${sessionId}"}\n`
    ),
    sessionId
  );
  assert.equal(
    parser.push(
      "stdout",
      `{"type":"assistant","session_id":"${sessionId}","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}\n`
    ),
    null
  );
});

test("Codex session parser extracts session ids from json thread events", () => {
  const parser = createHarnessSessionParser("codex");
  const sessionId = "123e4567-e89b-12d3-a456-426614174000";

  assert.equal(
    parser.push(
      "stdout",
      `{"type":"thread.started","thread_id":"${sessionId}"}\n`
    ),
    sessionId
  );
  assert.equal(
    parser.push(
      "stdout",
      `{"type":"thread.started","thread_id":"${sessionId}"}\n`
    ),
    null
  );
});

test("Codex session parser still accepts legacy human-readable output", () => {
  const parser = createHarnessSessionParser("codex");
  const sessionId = "123e4567-e89b-12d3-a456-426614174000";

  assert.equal(parser.push("stderr", `session id: ${sessionId}\n`), sessionId);
  assert.equal(parser.push("stderr", `codex session ${sessionId}\n`), null);
});
