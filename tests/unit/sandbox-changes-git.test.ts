import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildRevertScript } from "../../lib/sandbox/changes";

for (const all of [false, true]) {
  test(`revert ${all ? "all" : "file"} restores staged renames on disk and in the index`, () => {
    const cwd = mkdtempSync(join(tmpdir(), "mogplex-revert-"));
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith("GIT_")) delete env[key];
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd, env, encoding: "utf8" });
    const oldPath = "old ' ü.txt";
    const newPath = "new ' ü.txt";
    try {
      git("init", "-q");
      writeFileSync(join(cwd, oldPath), "original\n");
      writeFileSync(join(cwd, "other.txt"), "other\n");
      git("add", ".");
      git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-qm",
        "initial"
      );
      git("mv", oldPath, newPath);
      git("config", "status.renames", "false");
      writeFileSync(join(cwd, newPath), "edited destination\n");
      writeFileSync(join(cwd, "other.txt"), "changed\n");
      git("add", "other.txt");
      execFileSync(
        "sh",
        ["-c", buildRevertScript(all ? [newPath, "other.txt"] : [newPath])],
        { cwd, env }
      );
      assert.equal(readFileSync(join(cwd, oldPath), "utf8"), "original\n");
      assert.equal(existsSync(join(cwd, newPath)), false);
      assert.equal(git("show", `:${oldPath}`), "original\n");
      assert.equal(
        git("diff", "--cached", "--name-only"),
        all ? "" : "other.txt\n"
      );
      assert.equal(git("diff", "--name-only"), "");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
