import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getSandboxHeadViaSdk,
  parseGitHeadOutput,
  TERMINAL_COMMIT_SCRIPT,
  type SandboxCommandDeps,
  type SandboxRecord,
} from "../../lib/mogplex-api/run-terminal-commit";
import { SANDBOX_WORKSPACE_ROOT } from "../../lib/sandbox/working-directory";

function fixture(
  run: (input: {
    git: (cwd: string, ...args: string[]) => string;
    readPin: (
      cwd: string,
      branch: string
    ) => ReturnType<typeof parseGitHeadOutput>;
    root: string;
    remote: string;
  }) => void
) {
  const base = mkdtempSync(join(tmpdir(), "mogplex-terminal-commit-"));
  const root = join(base, "checkout");
  const remote = join(base, "remote.git");
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_")) delete env[key];
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8" });
  const readPin = (cwd: string, branch: string) =>
    parseGitHeadOutput(
      execFileSync("sh", ["-c", TERMINAL_COMMIT_SCRIPT], {
        cwd,
        env: { ...env, MOGPLEX_WORKING_BRANCH: branch },
        encoding: "utf8",
      })
    );
  try {
    execFileSync("git", ["init", "-q", "--bare", remote], { env });
    execFileSync("git", ["init", "-q", "-b", "main", root], { env });
    git(root, "config", "user.name", "Fixture");
    git(root, "config", "user.email", "fixture@example.test");
    git(root, "remote", "add", "origin", remote);
    writeFileSync(join(root, "README.md"), "base\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "base");
    git(root, "push", "-q", "origin", "main");
    run({ git, readPin, root, remote });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("the pin reads the run branch from a worktree, not the checkout root's HEAD", () =>
  fixture(({ git, readPin, root }) => {
    const worktree = join(root, ".worktrees", "run-a");
    git(root, "worktree", "add", "-q", "-b", "mogplex/run-a", worktree);
    writeFileSync(join(worktree, "artifact.json"), "{}\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-qm", "run output");
    git(worktree, "push", "-q", "origin", "mogplex/run-a");
    const runCommit = git(worktree, "rev-parse", "HEAD").trim();

    const pin = readPin(root, "mogplex/run-a");

    assert.notEqual(git(root, "rev-parse", "HEAD").trim(), runCommit);
    assert.deepEqual(pin, { sha: runCommit, pushed: true });
  }));

test("an unpushed run commit is read but not marked pushed", () =>
  fixture(({ git, readPin, root }) => {
    git(root, "switch", "-q", "-c", "mogplex/run-b");
    git(root, "push", "-q", "origin", "mogplex/run-b");
    writeFileSync(join(root, "late.json"), "{}\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "not pushed");
    const local = git(root, "rev-parse", "HEAD").trim();

    assert.deepEqual(readPin(root, "mogplex/run-b"), {
      sha: local,
      pushed: false,
    });
  }));

test("a branch that does not exist yields no pin", () =>
  fixture(({ readPin, root }) => {
    assert.deepEqual(readPin(root, "mogplex/missing"), {
      sha: null,
      pushed: false,
    });
  }));

test("the branch reaches the script through the environment at the workspace root", async () => {
  const calls: Array<{ script: string; env: Record<string, string> }> = [];
  const record = {
    id: "record-1",
    user_id: "user-1",
    status: "running",
    sandbox_id: "sandbox-1",
  } as SandboxRecord;
  const deps: SandboxCommandDeps = {
    loadSandboxRecord: async () => record,
    getSandboxHandle: async () => ({}) as never,
    runSandboxShell: async (_sandbox, script, env) => {
      calls.push({ script, env });
      return { exitCode: 0, stdout: "HEAD_SHA=\nORIGIN_SHA=", stderr: "" };
    },
  };
  const branch = 'feature/"$(touch pwned)"';

  await getSandboxHeadViaSdk("record-1", "user-1", branch, deps);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].script, TERMINAL_COMMIT_SCRIPT);
  assert.ok(!calls[0].script.includes(branch));
  assert.deepEqual(calls[0].env, { MOGPLEX_WORKING_BRANCH: branch });
  assert.equal(SANDBOX_WORKSPACE_ROOT, "/vercel/sandbox");
});
