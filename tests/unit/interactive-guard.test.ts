import assert from "node:assert/strict";
import test from "node:test";
import { detectInteractiveInvocation } from "../../lib/sandbox/interactive-guard";

test("bare claude is flagged as harness-bare", () => {
  const hit = detectInteractiveInvocation("claude");
  assert.ok(hit);
  assert.equal(hit.kind, "harness-bare");
  assert.equal(hit.binary, "claude");
  assert.match(hit.message, /claude -p/);
});

test("claude -p passes through", () => {
  const hit = detectInteractiveInvocation('claude -p "hello"');
  assert.equal(hit, null);
});

test("claude --print passes through", () => {
  const hit = detectInteractiveInvocation('claude --print "hello"');
  assert.equal(hit, null);
});

test("claude with any args passes through (e.g. --version, --help, config)", () => {
  assert.equal(detectInteractiveInvocation("claude --version"), null);
  assert.equal(detectInteractiveInvocation("claude --help"), null);
  assert.equal(detectInteractiveInvocation("claude config list"), null);
});

test("bare codex is flagged", () => {
  const hit = detectInteractiveInvocation("codex");
  assert.ok(hit);
  assert.equal(hit.kind, "harness-bare");
  assert.equal(hit.binary, "codex");
});

test("codex with args passes through", () => {
  const hit = detectInteractiveInvocation('codex run "task"');
  assert.equal(hit, null);
});

test("TUI binaries are flagged", () => {
  for (const bin of ["vim", "nvim", "nano", "htop", "less", "more", "ssh"]) {
    const hit = detectInteractiveInvocation(bin);
    assert.ok(hit, `expected hit for ${bin}`);
    assert.equal(hit.kind, "tui");
  }
});

test("TUI binaries with args still flagged (vim file.txt still needs PTY)", () => {
  const hit = detectInteractiveInvocation("vim README.md");
  assert.ok(hit);
  assert.equal(hit.kind, "tui");
});

test("editor hint points to Editor pane", () => {
  const hit = detectInteractiveInvocation("vim");
  assert.ok(hit);
  assert.match(hit.message, /Editor pane/);
});

test("bare REPL invocations are flagged", () => {
  for (const bin of ["python", "python3", "node", "irb", "bun", "deno"]) {
    const hit = detectInteractiveInvocation(bin);
    assert.ok(hit, `expected hit for bare ${bin}`);
    assert.equal(hit.kind, "repl-bare");
  }
});

test("REPL with script file passes through", () => {
  assert.equal(detectInteractiveInvocation("python3 script.py"), null);
  assert.equal(detectInteractiveInvocation("node server.js"), null);
});

test("REPL with -c passes through", () => {
  assert.equal(detectInteractiveInvocation('python3 -c "print(1)"'), null);
});

test("psql without command flag is flagged", () => {
  const hit = detectInteractiveInvocation("psql -h localhost -U postgres");
  assert.ok(hit);
  assert.equal(hit.kind, "db-repl");
});

test("psql -c passes through", () => {
  const hit = detectInteractiveInvocation('psql -c "SELECT 1"');
  assert.equal(hit, null);
});

test("mongosh --eval passes through", () => {
  const hit = detectInteractiveInvocation('mongosh --eval "db.stats()"');
  assert.equal(hit, null);
});

test("leading env-var assignments are skipped when resolving the binary", () => {
  const hit = detectInteractiveInvocation("FOO=bar BAZ=qux claude");
  assert.ok(hit);
  assert.equal(hit.binary, "claude");
});

test("ordinary commands are not flagged", () => {
  for (const cmd of [
    "ls",
    "ls -la",
    "pnpm install",
    "git status",
    "npm run build",
    "cat package.json",
    "echo hello",
  ]) {
    assert.equal(
      detectInteractiveInvocation(cmd),
      null,
      `expected no hit for: ${cmd}`
    );
  }
});

test("empty command returns null", () => {
  assert.equal(detectInteractiveInvocation(""), null);
  assert.equal(detectInteractiveInvocation("   "), null);
});
