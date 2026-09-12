import assert from "node:assert/strict";
import test from "node:test";
import { resolvePersistentSandboxOptions } from "../../lib/sandbox/client-validation";

test("workspace persistence is required without rollout flags", () => {
  assert.deepEqual(resolvePersistentSandboxOptions({}), {
    persistent: true,
    snapshotExpiration: 0,
  });
});

test("workspace creation rejects lossy persistence options", () => {
  assert.throws(
    () => resolvePersistentSandboxOptions({ persistent: false }),
    /must persist/
  );
  assert.throws(
    () => resolvePersistentSandboxOptions({ snapshotExpirationMs: 604800000 }),
    /must persist/
  );
});
