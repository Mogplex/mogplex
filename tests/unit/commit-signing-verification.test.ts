import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateCommitSigningKeyPair } from "../../lib/commit-signing/key-material";
import {
  buildSigningVerificationScript,
  signingVerificationResult,
} from "../../lib/commit-signing/verify-workspace";

function fixture(t: { after: (cleanup: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), "signing-verification-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const keyDir = path.join(root, ".mogplex/signing");
  mkdirSync(keyDir, { recursive: true });
  const key = generateCommitSigningKeyPair();
  const keyPath = path.join(keyDir, "id_ed25519");
  writeFileSync(keyPath, key.privateKey, { mode: 0o600 });
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"),
    GIT_CONFIG_SYSTEM: "/dev/null",
    TMPDIR: root,
  };
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
  assert.equal(git("init", "--quiet").status, 0);
  for (const [name, value] of [
    ["gpg.format", "ssh"],
    ["commit.gpgsign", "true"],
    ["user.signingkey", keyPath],
  ]) {
    assert.equal(git("config", "--global", name, value).status, 0);
  }
  const verify = (publicKey = key.publicKey) =>
    spawnSync(
      "sh",
      [
        "-c",
        buildSigningVerificationScript().replaceAll("$HOME", root),
        "signing-check",
        publicKey.trim().split(/\s+/).slice(0, 2).join(" "),
      ],
      { cwd: root, env, encoding: "utf8" }
    );
  return { root, keyPath, git, verify };
}

test("verifies a real SSH signature and leaves the checkout and temporary files unchanged", (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, "work-in-progress.txt"), "keep this work");
  const before = f.git("status", "--porcelain").stdout;
  const files = readdirSync(f.root).sort();
  const result = f.verify();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(signingVerificationResult(result.status!).status, "verified");
  assert.equal(f.git("status", "--porcelain").stdout, before);
  assert.notEqual(f.git("rev-parse", "--verify", "HEAD").status, 0);
  assert.deepEqual(readdirSync(f.root).sort(), files);
  assert.equal(result.stdout, "");
});

test("does not claim an inactive, replaced, or unreadable key is verified", (t) => {
  const f = fixture(t);
  assert.equal(f.verify(generateCommitSigningKeyPair().publicKey).status, 11);
  f.git("config", "commit.gpgsign", "false");
  assert.equal(f.verify().status, 10);
  f.git("config", "--unset", "commit.gpgsign");
  f.git("config", "gpg.ssh.program", "/untrusted/signer");
  assert.equal(f.verify().status, 10);
  f.git("config", "--unset", "gpg.ssh.program");
  writeFileSync(f.keyPath, "invalid private key");
  assert.equal(f.verify().status, 12);
  assert.equal(signingVerificationResult(10).status, "inactive");
  assert.equal(signingVerificationResult(11).status, "different_key");
  assert.equal(signingVerificationResult(12).status, "failed");
});
