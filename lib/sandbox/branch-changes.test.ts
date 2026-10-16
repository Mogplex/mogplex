import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  buildBranchChangesScript,
  parseBranchChangesOutput,
  readSandboxBranchChanges,
  splitUnifiedDiff,
} from "./branch-changes";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

/** A clone whose branch has one committed change, uncommitted edits and an untracked file. */
function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "branch-changes-"));
  dirs.push(root);
  const origin = join(root, "origin");
  const work = join(root, "work");
  execFileSync("git", ["init", "-q", "-b", "main", origin]);
  writeFileSync(join(origin, "keep.txt"), "one\ntwo\n");
  writeFileSync(join(origin, "old name.txt"), "rename me\n".repeat(5));
  writeFileSync(join(origin, "gone.txt"), "bye\n");
  git(origin, "add", ".");
  git(origin, "commit", "-qm", "base");
  execFileSync("git", ["clone", "-q", origin, work]);
  git(work, "checkout", "-qb", "agent/fix");
  writeFileSync(join(work, "keep.txt"), "one\nTWO\nthree\n");
  git(work, "commit", "-qam", "agent commit");
  renameSync(join(work, "old name.txt"), join(work, "new name.txt"));
  rmSync(join(work, "gone.txt"));
  git(work, "add", "-A");
  writeFileSync(
    join(work, "fresh.ts"),
    "export const a = 1;\nexport const b = 2;\n"
  );
  return work;
}

function runScript(cwd: string, base: string | null, maxBytes?: number) {
  return execFileSync("sh", ["-lc", buildBranchChangesScript(base, maxBytes)], {
    cwd,
    encoding: "utf8",
  });
}

it("should include committed, staged and untracked work when diffing against the base", () => {
  const work = fixtureRepo();

  const changes = parseBranchChangesOutput(runScript(work, "main"));

  expect(changes.files.map(({ patch: _patch, ...file }) => file)).toEqual([
    { path: "gone.txt", status: "deleted", additions: 0, deletions: 1 },
    { path: "keep.txt", status: "modified", additions: 2, deletions: 1 },
    {
      path: "new name.txt",
      previousPath: "old name.txt",
      status: "renamed",
      additions: 0,
      deletions: 0,
    },
    { path: "fresh.ts", status: "added", additions: 2, deletions: 0 },
  ]);
  expect(changes.patchTruncated).toBe(false);
  expect(changes.files[1].patch).toContain("+TWO");
  expect(changes.files[3].patch).toContain("+export const b = 2;");
});

it("should fall back to uncommitted work when the base branch is unknown", () => {
  const work = fixtureRepo();

  const changes = parseBranchChangesOutput(runScript(work, "no-such-base"));

  expect(changes.files.map((file) => file.path)).toEqual([
    "gone.txt",
    "new name.txt",
    "fresh.ts",
  ]);
});

it("should mark patches truncated and drop the cut line when the byte budget is hit", () => {
  const work = fixtureRepo();

  const changes = parseBranchChangesOutput(runScript(work, "main", 120), 120);

  const withPatch = changes.files.filter((file) => file.patch);
  expect(withPatch).toHaveLength(1);
  expect(withPatch[0].patch).toMatch(/\n$/);
  expect(changes.patchTruncated).toBe(true);
});

it("should split a unified diff into one chunk per file", () => {
  const patch =
    "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/y b/y\nBinary files differ\n";

  expect(splitUnifiedDiff(patch)).toEqual([
    "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n",
    "diff --git a/y b/y\nBinary files differ\n",
  ]);
});

it("should reject a failed sandbox command instead of reporting no changes", async () => {
  const sandbox = {
    runCommand: async () => ({
      exitCode: 128,
      stdout: async () => "",
      stderr: async () => "fatal: not a git repository",
    }),
  } as unknown as Parameters<typeof readSandboxBranchChanges>[0];

  await expect(
    readSandboxBranchChanges(sandbox, {
      cwd: "/vercel/sandbox",
      baseBranch: "main",
    })
  ).rejects.toThrow("not a git repository");
});
