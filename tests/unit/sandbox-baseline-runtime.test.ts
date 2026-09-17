import assert from "node:assert/strict";
import test from "node:test";
import type { Sandbox } from "@vercel/sandbox";
import { assertBaselineRuntime } from "../../lib/sandbox/baseline-runtime";
import { BaselineSnapshotRestoreError } from "../../lib/sandbox/baseline-errors";

test("a Node 22 baseline cannot boot a repository requiring Node 24", async () => {
  const sandbox = {
    runCommand: async () => ({ exitCode: 0, stdout: async () => "22.22.0\n" }),
  } as unknown as Sandbox;
  await assert.rejects(
    assertBaselineRuntime(sandbox, "node24"),
    (error: unknown) => {
      assert.ok(error instanceof BaselineSnapshotRestoreError);
      assert.equal(error.phase, "runtime");
      return true;
    }
  );
  await assertBaselineRuntime(sandbox, "node22");
});

test("baseline runtime probe failure uses the existing safe baseline fallback", async () => {
  const sandbox = {
    runCommand: async () => {
      throw new Error("VM unavailable");
    },
  } as unknown as Sandbox;
  await assert.rejects(
    assertBaselineRuntime(sandbox, "node24"),
    BaselineSnapshotRestoreError
  );
  await assertBaselineRuntime(sandbox, "python3.13");
});
