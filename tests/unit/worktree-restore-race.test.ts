import assert from "node:assert/strict";
import test from "node:test";
import { pruneWorktree, spawnWorktree } from "../../lib/worktrees/service";
import {
  buildTask,
  buildWorktree,
  WORKTREE_ID,
  RUN_ID,
  TASK_ID,
  REPO_ID,
  SANDBOX_ID,
} from "./helpers/worktree-restore-fixtures";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a prune paused after reading an archived checkout cannot remove a restoring checkout", async () => {
  let row = buildWorktree({ status: "archived" });
  let claimed = false;
  const loaded = gate();
  const resumePrune = gate();
  const restoring = gate();
  const finishRestore = gate();
  let pruneCommands = 0;
  const deps = {
    claimArchived: async () => {
      if (claimed || row.status !== "archived") return null;
      claimed = true;
      return "claim-token";
    },
    releaseArchived: async () => {
      claimed = false;
    },
  };
  const pruning = pruneWorktree(
    {
      userId: "user-1",
      worktreeId: WORKTREE_ID,
      runId: RUN_ID,
      repoId: REPO_ID,
    },
    {
      ...deps,
      load: async () => {
        const snapshot = { ...row };
        loaded.resolve();
        await resumePrune.promise;
        return snapshot;
      },
      execute: async () => {
        pruneCommands += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      markPruned: async () => {
        row = { ...row, status: "pruned" };
        return row;
      },
    }
  );
  await loaded.promise;
  const restoration = spawnWorktree(
    { userId: "user-1", runId: RUN_ID, taskId: TASK_ID, sandboxId: SANDBOX_ID },
    {
      ...deps,
      loadTask: async () => buildTask(),
      findLiveForTask: async () => row,
      loadSandbox: async () => ({
        id: SANDBOX_ID,
        repo_id: REPO_ID,
        status: "running",
      }),
      execute: async () => {
        restoring.resolve();
        await finishRestore.promise;
        return {
          exitCode: 0,
          stdout: `MOGPLEX_WORKTREE_PATH=${row.checkout_path}`,
          stderr: "",
        };
      },
      activate: async () => {
        row = { ...row, status: "active" };
        return row;
      },
    }
  );
  await restoring.promise;
  resumePrune.resolve();
  try {
    await assert.rejects(pruning, /changed|progress/i);
    assert.equal(pruneCommands, 0);
  } finally {
    finishRestore.resolve();
    await restoration;
  }
  assert.equal(row.status, "active");
  assert.equal(claimed, false);
});
