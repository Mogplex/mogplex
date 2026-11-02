import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCheckProbeCommand } from "../../lib/agents/orchestrator/checks/probe";

function withRepository(
  run: (input: {
    root: string;
    git: (...args: string[]) => void;
    probe: (paths?: string[]) => {
      revision: string;
      manifest: {
        packageManager: string;
        scripts: Record<string, string>;
        lockfiles: string[];
      };
    };
  }) => void
) {
  const root = mkdtempSync(join(tmpdir(), "mogplex-check-probe-"));
  const git = (...args: string[]) => {
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  };
  const probe = (paths: string[] = []) =>
    JSON.parse(
      execFileSync("sh", ["-lc", buildCheckProbeCommand(paths)], {
        cwd: root,
        encoding: "utf8",
      })
    );
  try {
    git("init", "-q");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@10.12.4",
        scripts: { typecheck: "tsc --noEmit", build: "next build" },
      })
    );
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    writeFileSync(join(root, ".gitignore"), ".mogplex/\n");
    writeFileSync(join(root, "index.ts"), "export const value = 1;\n");
    git("add", "--all");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--no-gpg-sign",
      "--no-verify",
      "-qm",
      "Fixture"
    );
    run({ root, git, probe });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the probe reports manifest choices and changes when tracked or untracked source changes", () => {
  withRepository(({ root, probe }) => {
    const first = probe();
    assert.match(first.revision, /^[a-f0-9]{64}$/);
    assert.equal(first.manifest.packageManager, "pnpm@10.12.4");
    assert.equal(first.manifest.scripts.build, "defined");
    assert.deepEqual(first.manifest.lockfiles, ["pnpm-lock.yaml"]);
    writeFileSync(join(root, "index.ts"), "export const value = 2;\n");
    const edited = probe();
    assert.notEqual(edited.revision, first.revision);
    writeFileSync(join(root, "new.ts"), "export const added = true;\n");
    assert.notEqual(probe().revision, edited.revision);
  });
});

test("committing unchanged source does not invalidate passing check evidence", () => {
  withRepository(({ root, git, probe }) => {
    writeFileSync(join(root, "new.ts"), "export const added = true;\n");
    const before = probe();
    git("add", "--all");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--no-gpg-sign",
      "--no-verify",
      "-qm",
      "Add file"
    );
    assert.equal(probe().revision, before.revision);
  });
});

test("explicitly edited ignored files participate without exposing file contents or executing filenames", () => {
  withRepository(({ root, probe }) => {
    const ordinary = probe().revision;
    mkdirSync(join(root, ".mogplex"));
    const path = ".mogplex/identity'$(touch unsafe).ts";
    const initial = probe([path]);
    writeFileSync(join(root, path), "sensitive-content-one");
    const created = probe([path]);
    assert.notEqual(created.revision, initial.revision);
    assert.doesNotMatch(JSON.stringify(created), /sensitive-content-one/);
    writeFileSync(join(root, path), "sensitive-content-two");
    assert.notEqual(probe([path]).revision, created.revision);
    assert.equal(probe().revision, ordinary);
    assert.equal(existsSync(join(root, "unsafe")), false);
    assert.throws(() => buildCheckProbeCommand(["../outside"]), /path/i);
  });
});
