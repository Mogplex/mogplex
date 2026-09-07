import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildChangesStatusScript,
  buildFileDiffScript,
  buildRevertScript,
  parseChangesOutput,
} from "../../lib/sandbox/changes";

function fixture(
  run: (
    git: (...args: string[]) => string,
    shell: (script: string) => string,
    write: (path: string, text: string) => void
  ) => void
) {
  const cwd = mkdtempSync(join(tmpdir(), "mogplex-status-"));
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_")) delete env[key];
  const execute = (command: string, args: string[]) =>
    execFileSync(command, args, { cwd, env, encoding: "utf8" });
  const git = (...args: string[]) => execute("git", args);
  try {
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    run(
      git,
      (script) => execute("sh", ["-c", script]),
      (path, text) => writeFileSync(join(cwd, path), text)
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("staged deletions retain their complete diff", () =>
  fixture((git, shell, write) => {
    write("deleted.ts", "original\n");
    git("add", ".");
    git("commit", "-qm", "initial");
    git("rm", "deleted.ts");
    assert.match(shell(buildFileDiffScript("deleted.ts")), /-original/);
  }));

test("status preserves Unicode, tabs, newlines, and renamed filenames end to end", () =>
  fixture((git, shell, write) => {
    const tracked = "café\ttracked\nfile.txt";
    const original = "old\tname.txt";
    const destination = "MOGPLEX_UNTRACKED_BEGIN";
    const untracked = "café\tnew\nfile.txt";
    write(tracked, "original\n");
    write(original, "rename\n");
    git("add", ".");
    git("commit", "-qm", "initial");
    write(tracked, "replacement\nextra\n");
    write(untracked, "new\nlines\n");
    git("mv", original, destination);
    const status = parseChangesOutput(
      shell(buildChangesStatusScript(null)),
      null
    );
    assert.deepEqual(
      status.files.find((file) => file.path === tracked),
      { path: tracked, status: "modified", additions: 2, deletions: 1 }
    );
    assert.deepEqual(
      status.files.find((file) => file.path === untracked),
      { path: untracked, status: "untracked", additions: 2, deletions: 0 }
    );
    assert.deepEqual(
      status.files.find((file) => file.path === destination),
      {
        path: destination,
        previousPath: original,
        status: "renamed",
        additions: 0,
        deletions: 0,
      }
    );
    assert.match(shell(buildFileDiffScript(untracked)), /\+new/);
    assert.match(shell(buildFileDiffScript(tracked)), /\+replacement/);
    shell(buildRevertScript(status.files.map((file) => file.path)));
    assert.equal(git("status", "--porcelain"), "");
  }));
