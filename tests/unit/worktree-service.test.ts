import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveWorktree,
  diffWorktree,
  pruneWorktree,
  rebaseWorktree,
  spawnWorktree,
} from "../../lib/worktrees/service";
import type {
  OrchestrationWorktreeDTO,
  WorktreeTaskContext,
} from "../../lib/worktrees/types";

const WORKTREE_ID = "11111111-2222-4333-8444-555555555555";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const REPO_ID = "44444444-4444-4444-8444-444444444444";
const SANDBOX_ID = "55555555-5555-4555-8555-555555555555";

function buildTask(): WorktreeTaskContext {
  return {
    id: TASK_ID,
    run_id: RUN_ID,
    repo_id: REPO_ID,
    branch_name: "mogplex/task/fix-login",
    base_branch: "main",
    agent_id: null,
    run: { id: RUN_ID, user_id: "user-1", repo_id: REPO_ID },
  };
}

function buildWorktree(
  overrides: Partial<OrchestrationWorktreeDTO> = {}
): OrchestrationWorktreeDTO {
  return {
    id: WORKTREE_ID,
    user_id: "user-1",
    run_id: RUN_ID,
    task_id: TASK_ID,
    repo_id: REPO_ID,
    sandbox_id: SANDBOX_ID,
    agent_id: null,
    branch_name: "mogplex/task/fix-login",
    base_branch: "main",
    checkout_path: `/vercel/sandbox/.worktrees/${WORKTREE_ID}`,
    status: "active",
    latest_commit_sha: null,
    error: null,
    metadata: {},
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
    archived_at: null,
    pruned_at: null,
    ...overrides,
  };
}

test("spawn creates a real checkout and persists the server-reported path", async () => {
  const activations: Array<Record<string, unknown>> = [];
  const worktree = await spawnWorktree(
    {
      userId: "user-1",
      runId: RUN_ID,
      taskId: TASK_ID,
      sandboxId: SANDBOX_ID,
    },
    {
      findLiveForTask: async () => null,
      loadTask: async () => buildTask(),
      loadSandbox: async () => ({
        id: SANDBOX_ID,
        repo_id: REPO_ID,
        status: "running",
      }),
      reserve: async () => ({
        worktree: buildWorktree({ status: "creating" }),
        created: true,
      }),
      execute: async ({ sandboxId, command, cwd }) => {
        assert.equal(sandboxId, SANDBOX_ID);
        assert.equal(cwd, undefined);
        assert.match(command, /worktree add/);
        return {
          exitCode: 0,
          stdout: `MOGPLEX_WORKTREE_PATH=/vercel/sandbox/.worktrees/${WORKTREE_ID}\n`,
          stderr: "",
        };
      },
      activate: async (input) => {
        activations.push(input);
        return buildWorktree();
      },
      markError: async () => {},
    }
  );

  assert.equal(worktree.status, "active");
  assert.deepEqual(activations, [
    {
      worktreeId: WORKTREE_ID,
      userId: "user-1",
      checkoutPath: `/vercel/sandbox/.worktrees/${WORKTREE_ID}`,
    },
  ]);
});

test("spawn is idempotent for an existing active task checkout", async () => {
  const existing = buildWorktree();
  const result = await spawnWorktree(
    {
      userId: "user-1",
      runId: RUN_ID,
      taskId: TASK_ID,
      sandboxId: SANDBOX_ID,
    },
    {
      findLiveForTask: async () => existing,
      loadTask: async () => buildTask(),
    }
  );
  assert.equal(result, existing);
});

test("spawn rejects reuse across missions or sandboxes", async () => {
  await assert.rejects(
    spawnWorktree(
      {
        userId: "user-1",
        runId: RUN_ID,
        taskId: TASK_ID,
        sandboxId: SANDBOX_ID,
      },
      {
        loadTask: async () => buildTask(),
        findLiveForTask: async () =>
          buildWorktree({
            run_id: "66666666-6666-4666-8666-666666666666",
          }),
      }
    ),
    /another mission/
  );

  await assert.rejects(
    spawnWorktree(
      {
        userId: "user-1",
        runId: RUN_ID,
        taskId: TASK_ID,
        sandboxId: "77777777-7777-4777-8777-777777777777",
      },
      {
        loadTask: async () => buildTask(),
        findLiveForTask: async () => buildWorktree({ status: "error" }),
      }
    ),
    /another sandbox/
  );
});

test("spawn returns an in-flight concurrent reservation without recreating it", async () => {
  let executed = false;
  const winner = buildWorktree({ status: "creating" });
  const result = await spawnWorktree(
    {
      userId: "user-1",
      runId: RUN_ID,
      taskId: TASK_ID,
      sandboxId: SANDBOX_ID,
    },
    {
      loadTask: async () => buildTask(),
      findLiveForTask: async () => null,
      loadSandbox: async () => ({
        id: SANDBOX_ID,
        repo_id: REPO_ID,
        status: "running",
      }),
      reserve: async () => ({ worktree: winner, created: false }),
      reclaimCreating: async () => null,
      execute: async () => {
        executed = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    }
  );
  assert.equal(result, winner);
  assert.equal(executed, false);
});

test("spawn atomically reclaims and resumes a stale creating reservation", async () => {
  const stale = buildWorktree({
    status: "creating",
    updated_at: "2026-08-12T23:00:00.000Z",
  });
  let reclaimedInput: unknown;
  let executed = false;
  const result = await spawnWorktree(
    {
      userId: "user-1",
      runId: RUN_ID,
      taskId: TASK_ID,
      sandboxId: SANDBOX_ID,
    },
    {
      loadTask: async () => buildTask(),
      findLiveForTask: async () => stale,
      loadSandbox: async () => ({
        id: SANDBOX_ID,
        repo_id: REPO_ID,
        status: "running",
      }),
      reclaimCreating: async (input) => {
        reclaimedInput = input;
        return { ...stale, updated_at: "2026-08-13T00:10:00.000Z" };
      },
      execute: async () => {
        executed = true;
        return {
          exitCode: 0,
          stdout: `MOGPLEX_WORKTREE_PATH=/vercel/sandbox/.worktrees/${WORKTREE_ID}\n`,
          stderr: "",
        };
      },
      activate: async () => buildWorktree(),
      markError: async () => {},
    }
  );

  assert.deepEqual(reclaimedInput, {
    worktreeId: WORKTREE_ID,
    userId: "user-1",
    expectedUpdatedAt: stale.updated_at,
  });
  assert.equal(executed, true);
  assert.equal(result.status, "active");
});

test("rebase and diff force execution into the persisted checkout", async () => {
  const calls: Array<{ cwd?: string; command: string }> = [];
  const deps = {
    load: async () => buildWorktree(),
    execute: async (input: { cwd?: string; command: string }) => {
      calls.push(input);
      return { exitCode: 0, stdout: "patch", stderr: "" };
    },
  };
  await rebaseWorktree(
    {
      userId: "user-1",
      worktreeId: WORKTREE_ID,
      runId: RUN_ID,
      repoId: REPO_ID,
    },
    deps
  );
  const diff = await diffWorktree(
    {
      userId: "user-1",
      worktreeId: WORKTREE_ID,
      runId: RUN_ID,
      repoId: REPO_ID,
    },
    deps
  );

  assert.equal(diff.diff, "patch");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.cwd === buildWorktree().checkout_path));
});

test("archive changes database state without touching sandbox lifecycle", async () => {
  let executed = false;
  const archived = await archiveWorktree(
    {
      userId: "user-1",
      worktreeId: WORKTREE_ID,
      runId: RUN_ID,
      repoId: REPO_ID,
    },
    {
      load: async () => buildWorktree(),
      execute: async () => {
        executed = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      archive: async () => buildWorktree({ status: "archived" }),
    }
  );
  assert.equal(archived.status, "archived");
  assert.equal(executed, false);
});

test("archive provides a recovery path for a failed worktree", async () => {
  const archived = await archiveWorktree(
    {
      userId: "user-1",
      worktreeId: WORKTREE_ID,
      runId: RUN_ID,
      repoId: REPO_ID,
    },
    {
      load: async () => buildWorktree({ status: "error" }),
      archive: async () => buildWorktree({ status: "archived" }),
    }
  );
  assert.equal(archived.status, "archived");
});

test("archive provides a manual recovery path for a stuck reservation", async () => {
  const archived = await archiveWorktree(
    {
      userId: "user-1",
      worktreeId: WORKTREE_ID,
      runId: RUN_ID,
      repoId: REPO_ID,
    },
    {
      load: async () => buildWorktree({ status: "creating" }),
      archive: async () => buildWorktree({ status: "archived" }),
    }
  );
  assert.equal(archived.status, "archived");
});

test("prune requires archive and removes only the persisted checkout", async () => {
  await assert.rejects(
    pruneWorktree(
      {
        userId: "user-1",
        worktreeId: WORKTREE_ID,
        runId: RUN_ID,
        repoId: REPO_ID,
      },
      { load: async () => buildWorktree() }
    ),
    /Archive the worktree/
  );

  let command = "";
  const pruned = await pruneWorktree(
    {
      userId: "user-1",
      worktreeId: WORKTREE_ID,
      runId: RUN_ID,
      repoId: REPO_ID,
      force: true,
    },
    {
      load: async () => buildWorktree({ status: "archived" }),
      execute: async (input) => {
        command = input.command;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      markPruned: async () => buildWorktree({ status: "pruned" }),
    }
  );
  assert.equal(pruned.status, "pruned");
  assert.match(command, new RegExp(WORKTREE_ID));
  assert.doesNotMatch(command, /sandbox (stop|pause|delete)/);
});

test("forced prune releases an archived binding when its sandbox is gone", async () => {
  let marked = false;
  const pruned = await pruneWorktree(
    {
      userId: "user-1",
      worktreeId: WORKTREE_ID,
      runId: RUN_ID,
      repoId: REPO_ID,
      force: true,
    },
    {
      load: async () => buildWorktree({ status: "archived" }),
      execute: async () => {
        throw new Error("Sandbox not found");
      },
      markPruned: async () => {
        marked = true;
        return buildWorktree({ status: "pruned" });
      },
    }
  );
  assert.equal(pruned.status, "pruned");
  assert.equal(marked, true);
});

test("lifecycle actions reject a worktree from another mission", async () => {
  await assert.rejects(
    diffWorktree(
      {
        userId: "user-1",
        worktreeId: WORKTREE_ID,
        runId: "66666666-6666-4666-8666-666666666666",
        repoId: REPO_ID,
      },
      { load: async () => buildWorktree() }
    ),
    /Worktree not found/
  );
});
