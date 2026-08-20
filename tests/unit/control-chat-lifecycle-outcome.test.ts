import assert from "node:assert/strict";
import test from "node:test";
import {
  getControlRunFinishState,
  getSandboxStartTerminalFailure,
} from "../../app/api/control/chat/_lib/lifecycle";

test("Control marks a structured sandbox launch failure as failed", () => {
  const terminalFailure = getSandboxStartTerminalFailure({
    success: true,
    output: {
      error: "Sandbox stopped before it became ready.",
      reason: "sandbox_unavailable",
    },
    toolCall: { toolName: "sandbox_start" },
  });

  assert.equal(terminalFailure, "Sandbox startup failed.");
  assert.deepEqual(getControlRunFinishState("stop", terminalFailure), {
    status: "failed",
    error: "Sandbox startup failed.",
    eventType: "failed",
    message: "Control run failed",
  });
});

test("Control keeps a ready sandbox launch eligible for success", () => {
  const terminalFailure = getSandboxStartTerminalFailure({
    success: true,
    output: {
      ok: true,
      sandboxId: "sandbox-new",
      status: "running",
    },
    toolCall: { toolName: "sandbox_start" },
  });

  assert.equal(terminalFailure, null);
  assert.equal(
    getControlRunFinishState("stop", terminalFailure).status,
    "success"
  );
});
