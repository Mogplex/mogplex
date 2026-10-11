import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";
import { observeShellCommand } from "../../lib/sandbox/observed-shell";

test("retains hidden failure evidence through pipelines and trailing successful commands", () => {
  const command = observeShellCommand(
    "bash -c 'exit 137' | cat; echo finished"
  );
  // Capture stderr without changing the shell under test's exit semantics.
  const result = spawnSync(command.cmd, command.args, { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /finished/);
  let stderr = "";
  for (const char of result.stderr) stderr += command.stderr(char);
  stderr += command.stderr("", true);
  assert.deepEqual(command.failures, [137]);
  assert.doesNotMatch(stderr, /MOGPLEX_EXIT/);
});

test("handled probes remain successful and failed commands retain stderr", () => {
  const probe = observeShellCommand(
    "grep missing /dev/null || true; echo done"
  );
  const result = spawnSync(probe.cmd, probe.args, { encoding: "utf8" });
  probe.stderr(result.stderr, true);
  assert.equal(result.status, 0);
  assert.deepEqual(probe.failures, []);
  const bad = observeShellCommand("echo broken >&2; exit 2");
  const failure = spawnSync(bad.cmd, bad.args, { encoding: "utf8" });
  assert.equal(failure.status, 2);
  assert.equal(bad.stderr(failure.stderr, true), "broken\n");
});
