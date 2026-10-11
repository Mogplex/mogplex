import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildWorkspaceDiffsScript,
  parseWorkspaceDiffs,
} from "../../lib/sandbox/changes-snapshot";

test("one sandbox script saves tracked and generated patches with safe filename framing", () => {
  const dir = mkdtempSync(join(tmpdir(), "mogplex-diff-batch-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    git("init");
    writeFileSync(join(dir, "tracked.ts"), "old\n");
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "baseline"
    );
    writeFileSync(join(dir, "tracked.ts"), "new\n");
    const generated = "generated 'odd\nname'.js";
    writeFileSync(join(dir, generated), "generated();\n");
    const output = execFileSync(
      "bash",
      ["-lc", buildWorkspaceDiffsScript(["tracked.ts", generated])],
      { cwd: dir, encoding: "utf8" }
    );
    const patches = parseWorkspaceDiffs(output, 2);
    assert.match(patches[0], /\+new/);
    assert.match(patches[1], /\+generated\(\)/);
    assert.throws(
      () => buildWorkspaceDiffsScript(["../secret"]),
      /Invalid path/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
