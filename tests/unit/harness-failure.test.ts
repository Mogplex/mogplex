import assert from "node:assert/strict";
import test from "node:test";
import {
  appendHarnessFailureOutput,
  presentHarnessFailure,
} from "../../lib/harness/failure";

test("presents model access failures without treating a valid key as invalid", () => {
  assert.deepEqual(
    presentHarnessFailure({
      harnessId: "claude-code",
      exitCode: 1,
      output:
        "API Error: Request rejected (429) - No access to this model at this time.",
    }),
    {
      code: "model_access_denied",
      message:
        "Anthropic accepted the API key, but the model selected by Claude Code is unavailable for this account. Check model access with Anthropic, then try again.",
    }
  );
});

test("presents generic provider throttling separately from model access", () => {
  assert.deepEqual(
    presentHarnessFailure({
      harnessId: "codex",
      exitCode: 1,
      output: "HTTP 429: rate limit exceeded",
    }),
    {
      code: "rate_limited",
      message: "OpenAI rate-limited this run. Wait a moment, then try again.",
    }
  );
});

test("bounds the output retained for failure classification", () => {
  assert.equal(appendHarnessFailureOutput("1234", "56789", 6), "456789");
});
