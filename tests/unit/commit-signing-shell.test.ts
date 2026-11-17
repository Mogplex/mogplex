import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { generateCommitSigningKeyPair } from "../../lib/commit-signing/key-material";
import {
  buildCommitSigningSetupScript,
  buildCommitSigningScrubScript,
} from "../../lib/sandbox/commit-signing";

function fixture(t: { after: (callback: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), "mogplex-signing-shell-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const staged = path.join(root, "staged-key");
  const key = path.join(root, ".mogplex/signing/id_ed25519");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"),
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
  const script = (source: string, overrides: Partial<NodeJS.ProcessEnv> = {}) =>
    spawnSync(
      "sh",
      [
        "-c",
        source
          .replaceAll("$HOME", root)
          .replaceAll("/tmp/.mogplex-commit-signing-key", staged)
          .replaceAll(
            'staged_key=".mogplex-commit-signing-key"',
            `staged_key="${staged}"`
          ),
      ],
      { cwd: root, env: { ...env, ...overrides }, encoding: "utf8" }
    );
  const stage = (value = generateCommitSigningKeyPair().privateKey) =>
    writeFileSync(staged, value, { mode: 0o600 });
  return { root, staged, key, git, script, stage };
}

test("the installed key signs a real commit and scrub removes only managed settings", (t) => {
  const f = fixture(t);
  f.stage();
  assert.equal(f.script(buildCommitSigningSetupScript()).status, 0);
  assert.equal(existsSync(f.staged), false);
  assert.equal(statSync(f.key).mode & 0o777, 0o600);
  assert.equal(f.git("init", "--quiet").status, 0);
  assert.equal(
    f.git(
      "-c",
      "user.name=Signing test",
      "-c",
      "user.email=signing@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "signed"
    ).status,
    0
  );
  assert.match(
    f.git("cat-file", "commit", "HEAD").stdout,
    /BEGIN SSH SIGNATURE/
  );
  f.stage();
  assert.equal(f.script(buildCommitSigningScrubScript()).status, 0);
  assert.equal(existsSync(f.key), false);
  assert.equal(existsSync(f.staged), false);
  assert.equal(
    f.git("config", "--global", "--get", "commit.gpgsign").status,
    1
  );
  f.git("config", "--global", "user.signingkey", "/custom/key");
  f.git("config", "--global", "commit.gpgsign", "true");
  assert.equal(f.script(buildCommitSigningScrubScript()).status, 0);
  assert.equal(
    f.git("config", "--global", "--get", "user.signingkey").stdout.trim(),
    "/custom/key"
  );
});

test("invalid replacements leave no staged key or broken managed signing config", (t) => {
  const f = fixture(t);
  f.stage();
  assert.equal(f.script(buildCommitSigningSetupScript()).status, 0);
  f.stage("invalid key");
  assert.equal(f.script(buildCommitSigningSetupScript()).status, 3);
  assert.equal(existsSync(f.staged), false);
  assert.equal(existsSync(f.key), false);
  assert.equal(
    f.git("config", "--global", "--get", "commit.gpgsign").status,
    1
  );
});

test("unsupported git cleans the staged key even before installation", (t) => {
  const f = fixture(t);
  const bin = path.join(f.root, "bin");
  mkdirSync(bin);
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  writeFileSync(
    path.join(bin, "git"),
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'git version 2.33.0'; else exec "${realGit}" "$@"; fi\n`,
    { mode: 0o700 }
  );
  f.stage();
  assert.equal(
    f.script(buildCommitSigningSetupScript(), {
      PATH: `${bin}:${process.env.PATH}`,
    }).status,
    3
  );
  assert.equal(existsSync(f.staged), false);
  assert.equal(existsSync(f.key), false);
});
