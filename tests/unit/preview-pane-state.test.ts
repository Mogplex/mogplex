import assert from "node:assert/strict";
import test from "node:test";
import {
  getPreviewFileSelectionResetState,
  resolvePreviewEnvVarHint,
} from "../../lib/preview-pane-state";

test("getPreviewFileSelectionResetState does not clear when the tracked sandbox is unchanged", () => {
  const result = getPreviewFileSelectionResetState("sandbox-1", "sandbox-1");

  assert.deepEqual(result, {
    trackedSandboxId: "sandbox-1",
    shouldClearActiveFile: false,
  });
});

test("getPreviewFileSelectionResetState clears when the sandbox identity changes", () => {
  const result = getPreviewFileSelectionResetState("sandbox-1", "sandbox-2");

  assert.deepEqual(result, {
    trackedSandboxId: "sandbox-2",
    shouldClearActiveFile: true,
  });
});

test("getPreviewFileSelectionResetState clears when the sandbox is removed", () => {
  const result = getPreviewFileSelectionResetState("sandbox-1", undefined);

  assert.deepEqual(result, {
    trackedSandboxId: null,
    shouldClearActiveFile: true,
  });
});

test("resolvePreviewEnvVarHint detects missing env vars in persisted dev output", () => {
  assert.equal(
    resolvePreviewEnvVarHint({
      lastPreviewError: "Dev server returned an application error",
      devLog: "Error: AUTH_SECRET env var is not set",
    }),
    "Missing auth secret environment variable"
  );
});
