import assert from "node:assert/strict";
import test from "node:test";
import {
  getControlRunFinishState,
  getControlStreamTerminalFailure,
  getSandboxStartTerminalFailure,
  updateSandboxStartTerminalFailure,
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

test("Control clears a failed launch when a sandbox retry succeeds", () => {
  const failed = updateSandboxStartTerminalFailure(null, {
    success: false,
    toolCall: { toolName: "sandbox_start" },
  });
  const recovered = updateSandboxStartTerminalFailure(failed, {
    success: true,
    output: { sandboxId: "sandbox-new", status: "running" },
    toolCall: { toolName: "sandbox_start" },
  });
  const afterOtherTool = updateSandboxStartTerminalFailure(recovered, {
    success: false,
    toolCall: { toolName: "spawn_worktree" },
  });

  assert.equal(failed, "Sandbox startup failed.");
  assert.equal(recovered, null);
  assert.equal(afterOtherTool, null);
});

test("Control keeps recoverable sandbox selection failures eligible for success", () => {
  for (const reason of ["multiple_sandboxes", "repo_mismatch"]) {
    const failure = updateSandboxStartTerminalFailure(
      "Sandbox startup failed.",
      {
        success: true,
        output: { error: "Selection required", reason },
        toolCall: { toolName: "sandbox_start" },
      }
    );

    assert.equal(failure, null);
    assert.equal(getControlRunFinishState("stop", failure).status, "success");
  }
});

test("Control preserves a sandbox root cause when its response stream also fails", () => {
  assert.equal(
    getControlStreamTerminalFailure("Sandbox startup failed."),
    "Sandbox startup failed."
  );
  assert.equal(
    getControlStreamTerminalFailure(null),
    "Control response stream failed."
  );
});
