import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnWorktree } from "../../lib/worktrees/service";
import { buildCreateWorktreeCommand } from "../../lib/worktrees/commands";
import {
  buildTask,
  buildWorktree,
  WORKTREE_ID,
  RUN_ID,
  TASK_ID,
  REPO_ID,
  SANDBOX_ID,
} from "./helpers/worktree-restore-fixtures";

test("spawning an archived checkout reactivates it while preserving uncommitted work", async () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "control-worktree-restore-"))
  );
  const repo = path.join(root, "repo");
  const origin = path.join(root, "origin.git");
  try {
    execFileSync("git", ["init", "--bare", origin], { stdio: "ignore" });
    execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "baseline"
    );
    git("remote", "add", "origin", origin);
    git("push", "origin", "main");
    const run = (command: string) =>
      execFileSync("sh", ["-c", command], {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    const task = buildTask();
    run(
      buildCreateWorktreeCommand({
        worktreeId: WORKTREE_ID,
        branchName: task.branch_name,
        baseBranch: "main",
      })
    );
    const checkout = path.join(repo, ".worktrees", WORKTREE_ID);
    writeFileSync(path.join(checkout, "keep.txt"), "Uncommitted user work\n");
    const originalCommit = git("-C", checkout, "rev-parse", "HEAD");
    const archived = buildWorktree({
      status: "archived",
      checkout_path: checkout,
    });
    let activated = false;
    const result = await spawnWorktree(
      {
        userId: "user-1",
        runId: RUN_ID,
        taskId: TASK_ID,
        sandboxId: SANDBOX_ID,
      },
      {
        loadTask: async () => task,
        findLiveForTask: async () => archived,
        loadSandbox: async () => ({
          id: SANDBOX_ID,
          repo_id: REPO_ID,
          status: "running",
        }),
        execute: async ({ command }) => ({
          exitCode: 0,
          stdout: run(command),
          stderr: "",
        }),
        activate: async (input) => {
          assert.equal(input.checkoutPath, checkout);
          activated = true;
          return { ...archived, status: "active", archived_at: null };
        },
      }
    );
    assert.equal(result.status, "active");
    assert.equal(activated, true);
    assert.equal(
      readFileSync(path.join(checkout, "keep.txt"), "utf8"),
      "Uncommitted user work\n"
    );
    assert.equal(git("-C", checkout, "rev-parse", "HEAD"), originalCommit);
    assert.equal(
      git("-C", checkout, "branch", "--show-current").trim(),
      task.branch_name
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("archived checkout restoration requires a running sandbox", async () => {
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
        findLiveForTask: async () => buildWorktree({ status: "archived" }),
        loadSandbox: async () => ({
          id: SANDBOX_ID,
          repo_id: REPO_ID,
          status: "stopped",
        }),
      }
    ),
    /Resume the sandbox/
  );
});
