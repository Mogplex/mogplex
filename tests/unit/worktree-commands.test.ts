import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreateWorktreeCommand,
  buildPruneWorktreeCommand,
  buildRebaseWorktreeCommand,
  parseCreatedWorktreePath,
} from "../../lib/worktrees/commands";

const WORKTREE_ID = "11111111-2222-4333-8444-555555555555";

test("create command makes an isolated checkout under the repository worktree directory", () => {
  const command = buildCreateWorktreeCommand({
    worktreeId: WORKTREE_ID,
    branchName: "mogplex/task/fix-login",
    baseBranch: "main",
  });

  assert.match(command, /git rev-parse --show-toplevel/);
  assert.match(command, /worktree add/);
  assert.match(
    command,
    /worktree_path="\$repo_root\/\.worktrees\/\$MOGPLEX_WORKTREE_ID"/
  );
  assert.match(command, /MOGPLEX_WORKTREE_PATH=/);
});

test("worktree commands reject unsafe refs and paths before reaching a shell", () => {
  assert.throws(
    () =>
      buildCreateWorktreeCommand({
        worktreeId: WORKTREE_ID,
        branchName: "feature/ok; touch /tmp/pwned",
        baseBranch: "main",
      }),
    /Invalid branch name/
  );
  assert.throws(
    () =>
      buildPruneWorktreeCommand({
        checkoutPath: "/vercel/sandbox/not-a-managed-checkout",
        force: false,
      }),
    /Invalid managed worktree path/
  );
});

test("created path parser accepts only the exact managed checkout marker", () => {
  assert.equal(
    parseCreatedWorktreePath(
      `noise\nMOGPLEX_WORKTREE_PATH=/vercel/sandbox/.worktrees/${WORKTREE_ID}\n`,
      WORKTREE_ID
    ),
    `/vercel/sandbox/.worktrees/${WORKTREE_ID}`
  );
  assert.equal(
    parseCreatedWorktreePath(
      `MOGPLEX_WORKTREE_PATH=/tmp/${WORKTREE_ID}\n`,
      WORKTREE_ID
    ),
    null
  );
});

test("rebase and prune always target the persisted checkout path", () => {
  const checkoutPath = `/vercel/sandbox/.worktrees/${WORKTREE_ID}`;
  const rebase = buildRebaseWorktreeCommand({ baseBranch: "main" });
  const prune = buildPruneWorktreeCommand({ checkoutPath, force: true });

  assert.match(rebase, /git rebase "origin\/\$MOGPLEX_BASE_BRANCH"/);
  assert.match(rebase, /git rebase --abort/);
  assert.match(prune, /worktree remove --force/);
  assert.match(prune, new RegExp(WORKTREE_ID));
});
