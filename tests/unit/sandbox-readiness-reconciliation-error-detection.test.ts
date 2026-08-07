import assert from "node:assert/strict";
import test from "node:test";
import { loadSandboxReadinessReconciliation } from "./helpers/sandbox-readiness-reconciliation-fixtures";

test("isSnapshotNotFoundSandboxError detects SDK-envelope code (.json.error.code)", async () => {
  const { isSnapshotNotFoundSandboxError } =
    await loadSandboxReadinessReconciliation();
  const error = Object.assign(new Error("Snapshot not found"), {
    status: 400,
    json: { error: { code: "snapshot_not_found", message: "gone" } },
  });
  assert.equal(isSnapshotNotFoundSandboxError(error), true);
});

test("isSnapshotNotFoundSandboxError detects top-level .code", async () => {
  const { isSnapshotNotFoundSandboxError } =
    await loadSandboxReadinessReconciliation();
  const error = Object.assign(new Error("Snapshot not found"), {
    code: "snapshot_not_found",
  });
  assert.equal(isSnapshotNotFoundSandboxError(error), true);
});

test("isSnapshotNotFoundSandboxError detects HTTP 400 with marker in .body (object)", async () => {
  const { isSnapshotNotFoundSandboxError } =
    await loadSandboxReadinessReconciliation();
  const error = Object.assign(new Error("Bad request"), {
    status: 400,
    body: { error: { code: "snapshot_not_found" } },
  });
  assert.equal(isSnapshotNotFoundSandboxError(error), true);
});

test("isSnapshotNotFoundSandboxError detects HTTP 400 with marker in .body (raw string)", async () => {
  const { isSnapshotNotFoundSandboxError } =
    await loadSandboxReadinessReconciliation();
  const error = Object.assign(new Error("Bad request"), {
    status: 400,
    body: '{"error":{"code":"snapshot_not_found"}}',
  });
  assert.equal(isSnapshotNotFoundSandboxError(error), true);
});

test("isSnapshotNotFoundSandboxError does not swallow unrelated 400 errors that mention the marker outside body/data", async () => {
  const { isSnapshotNotFoundSandboxError } =
    await loadSandboxReadinessReconciliation();
  // The marker appears only in the message — neither .body nor .data carry it,
  // so the fallback path must not match.
  const error = Object.assign(
    new Error("Validation failed: snapshot_not_found is reserved"),
    {
      status: 400,
      body: { error: { code: "validation_error" } },
    }
  );
  assert.equal(isSnapshotNotFoundSandboxError(error), false);
});

test("isSnapshotNotFoundSandboxError ignores non-400 errors even if body contains the marker", async () => {
  const { isSnapshotNotFoundSandboxError } =
    await loadSandboxReadinessReconciliation();
  const error = Object.assign(new Error("Server error"), {
    status: 500,
    body: { error: { code: "snapshot_not_found" } },
  });
  assert.equal(isSnapshotNotFoundSandboxError(error), false);
});
