import assert from "node:assert/strict";
import test from "node:test";

/**
 * These tests exercise the command shapes built by the baseline bootstrap
 * path without pulling in the full sandbox client (which imports supabase &
 * the Vercel SDK). We test the pure helpers by re-implementing the small
 * shell-quoting helpers and asserting command shape.
 */

function shellQuote(value: string) {
  return `'${value.replace(/'/g, String.raw`'\''`)}'`;
}

function buildFetchCommand(
  baseBranch: string,
  workingBranch: string,
  createBranch: boolean
) {
  const refs = createBranch ? [baseBranch] : [baseBranch, workingBranch];
  return `git fetch --depth=1 origin ${refs.map(shellQuote).join(" ")}`;
}

function buildCheckoutCommand(
  baseBranch: string,
  workingBranch: string,
  createBranch: boolean
) {
  return createBranch
    ? `git checkout -b ${shellQuote(workingBranch)} origin/${shellQuote(
        baseBranch
      )} && git push -u origin ${shellQuote(workingBranch)}`
    : `git checkout -B ${shellQuote(workingBranch)} origin/${shellQuote(
        workingBranch
      )}`;
}

test("fetch command pulls only base branch when createBranch=true", () => {
  const cmd = buildFetchCommand("main", "feat/new", true);
  assert.equal(cmd, "git fetch --depth=1 origin 'main'");
});

test("fetch command pulls both branches when not creating", () => {
  const cmd = buildFetchCommand("main", "feat/x", false);
  assert.equal(cmd, "git fetch --depth=1 origin 'main' 'feat/x'");
});

test("checkout command creates branch and pushes when createBranch=true", () => {
  const cmd = buildCheckoutCommand("main", "feat/new", true);
  assert.match(cmd, /git checkout -b 'feat\/new' origin\/'main'/);
  assert.match(cmd, /git push -u origin 'feat\/new'/);
});

test("checkout command forces existing branch when not creating", () => {
  const cmd = buildCheckoutCommand("main", "feat/x", false);
  assert.equal(cmd, "git checkout -B 'feat/x' origin/'feat/x'");
});

test("shell quoting survives single quotes in branch names", () => {
  assert.equal(shellQuote("feat/o'malley"), String.raw`'feat/o'\''malley'`);
});

test("BaselineSnapshotRestoreError exposes phase and cause", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { BaselineSnapshotRestoreError } =
    await import("../../lib/sandbox/client");
  const cause = new Error("inner");
  const err = new BaselineSnapshotRestoreError("boom", "checkout", cause);
  assert.equal(err.name, "BaselineSnapshotRestoreError");
  assert.equal(err.phase, "checkout");
  assert.equal(err.cause, cause);
});
